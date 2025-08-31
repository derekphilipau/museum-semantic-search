#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { esClient, INDEX_NAME } from './lib/elasticsearch';
import { generateImageEmbedding } from '../lib/embeddings/image';
import { EMBEDDING_MODELS, type ModelKey } from '../lib/embeddings/types';
import { Artwork } from '../app/types';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

interface Progress {
  lastProcessedId: string;
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  timestamp: string;
}

interface EmbeddingRecord {
  artwork_id: string;
  embedding: number[];
  timestamp: string;
  model: string;
  dimension: number;
  metadata: {
    title: string;
    artist: string;
    collection: string;
  };
}

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function loadProgress(progressPath: string): Promise<Progress | null> {
  try {
    const data = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveProgress(progressPath: string, progress: Progress) {
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}

async function fetchArtworksFromElasticsearch(afterId?: string): Promise<{ artworks: Artwork[], total: number }> {
  const body: any = {
    query: {
      match_all: {}  // Get all documents since we can't query on non-indexed image field
    },
    sort: [{ '_id': 'asc' }],
    size: 1000
  };

  // For pagination
  if (afterId) {
    body.search_after = [afterId];
  }

  const response = await esClient.search({
    index: INDEX_NAME,
    body,
    _source: ['id', 'metadata', 'image', 'searchableText']
  });
  
  const artworks = response.hits.hits.map((hit: any) => ({
    id: hit._source.id,
    metadata: hit._source.metadata,
    image: hit._source.image,
    searchableText: hit._source.searchableText,
    embeddings: {}  // Add empty embeddings field
  }));

  return {
    artworks,
    total: typeof response.hits.total === 'object' ? response.hits.total.value : response.hits.total
  };
}

async function processArtwork(
  artwork: Artwork,
  model: ModelKey,
  writer: any
): Promise<{ processed: number; skipped: number; failed: number }> {
  try {
    const imageUrl = typeof artwork.image === 'string' ? artwork.image : artwork.image.url;
    
    if (!imageUrl) {
      console.log(`  No image URL for ${artwork.metadata.id}`);
      return { processed: 0, skipped: 1, failed: 0 };
    }

    // For models that support interleaved text, use searchableText
    const modelConfig = EMBEDDING_MODELS[model];
    const interleaveText = modelConfig.supportsInterleaved && artwork.searchableText
      ? artwork.searchableText
      : undefined;

    // Download image to temp file
    const tempDir = path.join(process.cwd(), 'tmp');
    await ensureDirectoryExists(tempDir);
    const tempFile = path.join(tempDir, `temp_${Date.now()}.jpg`);
    
    try {
      // Download image
      console.log(`  Downloading image for ${artwork.metadata.title}...`);
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      await fs.writeFile(tempFile, Buffer.from(buffer));
      
      // Generate embedding
      console.log(`  Generating ${model} embedding...`);
      const result = await generateImageEmbedding(tempFile, model, interleaveText);
      
      // Clean up temp file
      await fs.unlink(tempFile);
      
      if (result && result.embedding && result.embedding.length > 0) {
        const record: EmbeddingRecord = {
          artwork_id: artwork.id,
          embedding: result.embedding,
          timestamp: new Date().toISOString(),
          model: result.model,
          dimension: result.dimension,
          metadata: {
            title: artwork.metadata.title,
            artist: artwork.metadata.artist,
            collection: artwork.metadata.collection
          }
        };
        
        writer.write(JSON.stringify(record) + '\n');
        return { processed: 1, skipped: 0, failed: 0 };
      } else {
        console.log(`  Failed to generate embedding`);
        return { processed: 0, skipped: 0, failed: 1 };
      }
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  } catch (error) {
    console.error(`  Error processing ${artwork.metadata.id}:`, error);
    return { processed: 0, skipped: 0, failed: 1 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modelArg = args.find(arg => arg.startsWith('--model='));
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const resume = args.includes('--resume');
  
  if (!modelArg) {
    console.log(`
Generate embeddings to files for later loading into Elasticsearch

Usage:
  npm run generate-embeddings-to-file -- --model=MODEL [--limit=N] [--resume]

Models:
  - jina_embeddings_v4
  - google_vertex_multimodal

Options:
  --model=MODEL   Model to generate embeddings for (required)
  --limit=N       Limit to N artworks (optional)
  --resume        Resume from last checkpoint (optional)

Output:
  data/embeddings/[model_name]/embeddings.jsonl
  data/embeddings/[model_name]/progress.json
`);
    process.exit(1);
  }
  
  const model = modelArg.split('=')[1] as ModelKey;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  
  if (!EMBEDDING_MODELS[model]) {
    console.error(`Invalid model: ${model}`);
    console.log('Available models:', Object.keys(EMBEDDING_MODELS).join(', '));
    process.exit(1);
  }
  
  console.log('Artwork Embedding Generation to File');
  console.log('====================================');
  console.log(`Model: ${model}`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log(`Resume: ${resume}`);
  
  // Setup output directory
  const outputDir = path.join(process.cwd(), 'data', 'embeddings', model);
  await ensureDirectoryExists(outputDir);
  
  const outputPath = path.join(outputDir, 'embeddings.jsonl');
  const progressPath = path.join(outputDir, 'progress.json');
  
  // Load progress if resuming
  let progress: Progress = {
    lastProcessedId: '',
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    timestamp: new Date().toISOString()
  };
  
  if (resume) {
    const savedProgress = await loadProgress(progressPath);
    if (savedProgress) {
      progress = savedProgress;
      console.log(`\nResuming from artwork ${progress.lastProcessedId}`);
      console.log(`Previously processed: ${progress.totalProcessed}`);
    }
  }
  
  // Open output file
  const writer = createWriteStream(outputPath, { flags: resume ? 'a' : 'w' });
  
  try {
    let hasMore = true;
    let totalArtworks = 0;
    let processedInSession = 0;
    
    while (hasMore) {
      const { artworks, total } = await fetchArtworksFromElasticsearch(
        progress.lastProcessedId || undefined
      );
      
      if (totalArtworks === 0) {
        totalArtworks = total;
        console.log(`\nTotal artworks with images: ${totalArtworks}`);
      }
      
      if (artworks.length === 0) {
        hasMore = false;
        break;
      }
      
      for (const artwork of artworks) {
        // Skip if we've reached the limit
        if (limit && processedInSession >= limit) {
          hasMore = false;
          break;
        }
        
        const overallIndex = progress.totalProcessed + progress.totalSkipped + progress.totalFailed + 1;
        console.log(`\n[${overallIndex}/${limit || totalArtworks}] Processing: ${artwork.metadata.title}`);
        
        const result = await processArtwork(artwork, model, writer);
        
        progress.totalProcessed += result.processed;
        progress.totalSkipped += result.skipped;
        progress.totalFailed += result.failed;
        progress.lastProcessedId = artwork.id;
        progress.timestamp = new Date().toISOString();
        
        processedInSession += result.processed;
        
        // Save progress every 10 artworks
        if ((progress.totalProcessed + progress.totalSkipped + progress.totalFailed) % 10 === 0) {
          await saveProgress(progressPath, progress);
        }
      }
      
      // If we've processed fewer artworks than returned, we might have more
      hasMore = hasMore && artworks.length === 1000;
    }
    
    // Final progress save
    await saveProgress(progressPath, progress);
    
    console.log('\n\nSummary');
    console.log('=======');
    console.log(`Total processed: ${progress.totalProcessed}`);
    console.log(`Total skipped: ${progress.totalSkipped}`);
    console.log(`Total failed: ${progress.totalFailed}`);
    console.log(`\nEmbeddings saved to: ${outputPath}`);
    
  } finally {
    writer.end();
  }
  
  // Clean up temp directory
  try {
    const tempDir = path.join(process.cwd(), 'tmp');
    await fs.rmdir(tempDir);
  } catch {}
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}