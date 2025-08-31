#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { MoMAParser } from './lib/parsers/moma-parser';
import { generateImageEmbedding } from '../lib/embeddings/image';
import { EMBEDDING_MODELS, type ModelKey } from '../lib/embeddings/types';
import { ParsedArtwork } from './lib/parsers/types';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

interface Progress {
  lastProcessedIndex: number;
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  lastArtworkId: string;
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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadWithRetry(url: string, maxRetries: number = 3): Promise<ArrayBuffer> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error: any) {
      console.log(`  Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`  Waiting ${waitTime}ms before retry...`);
      await sleep(waitTime);
    }
  }
  throw new Error('Failed after all retries');
}

async function processArtwork(
  artwork: ParsedArtwork,
  model: ModelKey,
  writer: any
): Promise<{ processed: number; skipped: number; failed: number }> {
  try {
    const imageUrl = artwork.image?.url;
    
    if (!imageUrl) {
      console.log(`  No image URL for ${artwork.id}`);
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
      // Download image with retry
      console.log(`  Downloading image...`);
      const buffer = await downloadWithRetry(imageUrl);
      await fs.writeFile(tempFile, Buffer.from(buffer));
      
      // Generate embedding with retry for network errors
      console.log(`  Generating ${model} embedding...`);
      if (interleaveText) {
        console.log(`  Using text+image: "${interleaveText.substring(0, 50)}..."`);
      }
      
      let result;
      let embedAttempt = 0;
      const maxEmbedRetries = 3;
      
      while (embedAttempt < maxEmbedRetries) {
        try {
          embedAttempt++;
          result = await generateImageEmbedding(tempFile, model, interleaveText);
          break; // Success, exit retry loop
        } catch (error: any) {
          if (embedAttempt === maxEmbedRetries || 
              !error.message?.includes('ECONNRESET') && 
              !error.message?.includes('fetch failed') &&
              !error.message?.includes('ETIMEDOUT')) {
            throw error; // Not a network error or max retries reached
          }
          console.log(`  Embedding attempt ${embedAttempt}/${maxEmbedRetries} failed: ${error.message}`);
          const waitTime = Math.min(1000 * Math.pow(2, embedAttempt - 1), 10000);
          console.log(`  Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
        }
      }
      
      // Clean up temp file
      await fs.unlink(tempFile);
      
      if (result && result.embedding && result.embedding.length > 0) {
        const record: EmbeddingRecord = {
          artwork_id: artwork.metadata.id,  // Use metadata.id instead of artwork.id
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
        console.log(`  ✓ Success (${result.dimension} dimensions)`);
        return { processed: 1, skipped: 0, failed: 0 };
      } else {
        console.log(`  ✗ Failed to generate embedding`);
        return { processed: 0, skipped: 0, failed: 1 };
      }
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  } catch (error: any) {
    console.error(`  ✗ Error: ${error.message}`);
    return { processed: 0, skipped: 0, failed: 1 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modelArg = args.find(arg => arg.startsWith('--model='));
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const resume = args.includes('--resume');
  const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
  
  if (!modelArg) {
    console.log(`
Generate embeddings from MoMA CSV to files

Usage:
  npm run generate-embeddings-to-file -- --model=MODEL [--limit=N] [--resume] [--batch-size=N]

Models:
  - jina_embeddings_v4
  - google_vertex_multimodal

Options:
  --model=MODEL     Model to generate embeddings for (required)
  --limit=N         Limit to N artworks (optional)
  --resume          Resume from last checkpoint (optional)
  --batch-size=N    Save progress every N artworks (default: 10)

Output:
  data/embeddings/[model_name]/embeddings.jsonl
  data/embeddings/[model_name]/progress.json

Example:
  npm run generate-embeddings-to-file -- --model=jina_embeddings_v4 --limit=1000
  npm run generate-embeddings-to-file -- --model=jina_embeddings_v4 --resume
`);
    process.exit(1);
  }
  
  const model = modelArg.split('=')[1] as ModelKey;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 10;
  
  if (!EMBEDDING_MODELS[model]) {
    console.error(`Invalid model: ${model}`);
    console.log('Available models:', Object.keys(EMBEDDING_MODELS).join(', '));
    process.exit(1);
  }
  
  console.log('MoMA Artwork Embedding Generation to File');
  console.log('========================================');
  console.log(`Model: ${model}`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log(`Resume: ${resume}`);
  console.log(`Save progress every: ${batchSize} artworks`);
  
  // Parse MoMA CSV
  const parser = new MoMAParser();
  const csvPath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
  
  console.log('\nParsing MoMA CSV...');
  let artworks: ParsedArtwork[];
  try {
    artworks = await parser.parseFile(csvPath);
    console.log(`Found ${artworks.length} artworks total`);
    
    // Filter to only those with images
    artworks = artworks.filter(a => a.image?.url);
    console.log(`With images: ${artworks.length}`);
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    process.exit(1);
  }
  
  // Setup output directory
  const outputDir = path.join(process.cwd(), 'data', 'embeddings', model);
  await ensureDirectoryExists(outputDir);
  
  const outputPath = path.join(outputDir, 'embeddings.jsonl');
  const progressPath = path.join(outputDir, 'progress.json');
  
  // Load progress if resuming
  let progress: Progress = {
    lastProcessedIndex: -1,
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    lastArtworkId: '',
    timestamp: new Date().toISOString()
  };
  
  if (resume) {
    const savedProgress = await loadProgress(progressPath);
    if (savedProgress) {
      progress = savedProgress;
      console.log(`\nResuming from index ${progress.lastProcessedIndex} (artwork ${progress.lastArtworkId})`);
      console.log(`Previously processed: ${progress.totalProcessed}`);
      console.log(`Previously skipped: ${progress.totalSkipped}`);
      console.log(`Previously failed: ${progress.totalFailed}`);
    }
  }
  
  // Open output file
  const writer = createWriteStream(outputPath, { flags: resume ? 'a' : 'w' });
  
  try {
    let processedInSession = 0;
    const startIndex = progress.lastProcessedIndex + 1;
    const endIndex = limit ? Math.min(startIndex + limit, artworks.length) : artworks.length;
    
    console.log(`\nProcessing artworks ${startIndex + 1} to ${endIndex}...\n`);
    
    for (let i = startIndex; i < endIndex; i++) {
      const artwork = artworks[i];
      console.log(`[${i + 1}/${endIndex}] ${artwork.metadata.title} by ${artwork.metadata.artist || 'Unknown'}`);
      
      const result = await processArtwork(artwork, model, writer);
      
      progress.totalProcessed += result.processed;
      progress.totalSkipped += result.skipped;
      progress.totalFailed += result.failed;
      progress.lastProcessedIndex = i;
      progress.lastArtworkId = artwork.metadata.id;
      progress.timestamp = new Date().toISOString();
      
      processedInSession += result.processed;
      
      // Save progress periodically
      if ((i - startIndex + 1) % batchSize === 0) {
        await saveProgress(progressPath, progress);
        console.log(`  → Progress saved\n`);
      }
    }
    
    // Final progress save
    await saveProgress(progressPath, progress);
    
    console.log('\n\nSummary');
    console.log('=======');
    console.log(`Processed in this session: ${processedInSession}`);
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