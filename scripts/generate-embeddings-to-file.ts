#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { parse } from 'csv-parse';
import { generateImageEmbedding } from '../lib/embeddings/image';
import { EMBEDDING_MODELS, type ModelKey } from '../lib/embeddings/types';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

// Departments we want to include
const ALLOWED_DEPARTMENTS = [
  'European Paintings',
  'Greek and Roman Art',
  'Egyptian Art',
  'Asian Art',
  'Islamic Art',
  'Medieval Art',
  'Ancient Near Eastern Art'
];

interface Progress {
  lastProcessedIndex: number;
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  lastObjectId: number;
  timestamp: string;
}

interface EmbeddingRecord {
  object_id: number;
  embedding: number[];
  timestamp: string;
  model: string;
  dimension: number;
}

async function loadProgress(model: ModelKey): Promise<Progress> {
  const progressPath = path.join(process.cwd(), 'data', 'embeddings', model, 'progress.json');
  try {
    const data = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      lastProcessedIndex: -1,
      totalProcessed: 0,
      totalSkipped: 0,
      totalFailed: 0,
      lastObjectId: 0,
      timestamp: new Date().toISOString()
    };
  }
}

async function saveProgress(model: ModelKey, progress: Progress): Promise<void> {
  const progressPath = path.join(process.cwd(), 'data', 'embeddings', model, 'progress.json');
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}

async function getArtworksToProcess(): Promise<Array<{object_id: number, has_image: boolean}>> {
  const artworks: Array<{object_id: number, has_image: boolean}> = [];
  const csvPath = path.join(process.cwd(), 'data', 'MetObjects.csv');
  
  // Get list of available images
  const imageDir = path.join(process.cwd(), 'data', 'images', 'huggingface');
  const imageFiles = new Set<number>();
  
  try {
    const files = await fs.readdir(imageDir);
    for (const file of files) {
      if (file.endsWith('.jpg')) {
        const objectId = parseInt(file.split('.')[0]);
        if (!isNaN(objectId)) {
          imageFiles.add(objectId);
        }
      }
    }
  } catch (error) {
    console.error('Error reading image directory:', error);
  }
  
  console.log(`Found ${imageFiles.size} images in huggingface directory`);
  
  // Read CSV and filter
  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relaxColumnCount: true,
      skipRecordsWithError: true
    });
    
    parser.on('readable', function() {
      let record: any;
      while ((record = parser.read()) !== null) {
        // Only include public domain artworks from allowed departments
        if (record['Is Public Domain'] === 'True' && 
            ALLOWED_DEPARTMENTS.includes(record['Department'])) {
          const objectId = parseInt(record['Object ID']);
          artworks.push({
            object_id: objectId,
            has_image: imageFiles.has(objectId)
          });
        }
      }
    });
    
    parser.on('end', () => {
      // Sort by object ID for consistent ordering
      artworks.sort((a, b) => a.object_id - b.object_id);
      console.log(`Found ${artworks.length} artworks in selected departments`);
      console.log(`With images: ${artworks.filter(a => a.has_image).length}`);
      resolve(artworks);
    });
    
    parser.on('error', reject);
    
    createReadStream(csvPath).pipe(parser);
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processArtwork(
  artwork: {object_id: number, has_image: boolean},
  model: ModelKey,
  writer: any,
  index: number,
  total: number,
  lastRequestTime: { time: number }
): Promise<{processed: number, skipped: number, failed: number}> {
  if (!artwork.has_image) {
    return { processed: 0, skipped: 1, failed: 0 };
  }
  
  const imagePath = path.join(
    process.cwd(),
    'data',
    'images',
    'huggingface',
    `${artwork.object_id}.jpg`
  );
  
  try {
    // No rate limiting needed for current models (Jina and Google have generous limits)
    
    console.log(`[${index + 1}/${total}] Processing ${artwork.object_id}...`);
    
    // Generate embedding
    const result = await generateImageEmbedding(imagePath, model);
    
    if (result && result.embedding && result.embedding.length > 0) {
      const record: EmbeddingRecord = {
        object_id: artwork.object_id,
        embedding: result.embedding,
        timestamp: new Date().toISOString(),
        model: result.model,
        dimension: result.dimension
      };
      
      writer.write(JSON.stringify(record) + '\n');
      return { processed: 1, skipped: 0, failed: 0 };
    } else {
      console.log(`  Failed to generate embedding`);
      return { processed: 0, skipped: 0, failed: 1 };
    }
  } catch (error) {
    console.error(`  Error processing ${artwork.object_id}:`, error);
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
Generate embeddings to a single file per model for later loading into Elasticsearch

Usage:
  npm run generate-embeddings-to-file -- --model=MODEL [--limit=N] [--resume]

Models:
  - jina_clip_v2
  - google_vertex_multimodal

Options:
  --limit=N        Process only N artworks (for testing)
  --resume         Resume from last checkpoint

Example:
  npm run generate-embeddings-to-file -- --model=jina_clip_v2 --limit=100
`);
    process.exit(1);
  }
  
  const model = modelArg.split('=')[1] as ModelKey;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  
  if (!EMBEDDING_MODELS[model]) {
    console.error(`Invalid model: ${model}`);
    process.exit(1);
  }
  
  console.log(`Generating ${model} embeddings`);
  if (limit) {
    console.log(`Limit: ${limit} artworks`);
  }
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'data', 'embeddings', model);
  await fs.mkdir(outputDir, { recursive: true });
  
  // Load progress
  const progress = await loadProgress(model);
  const startIdx = resume ? progress.lastProcessedIndex + 1 : 0;
  
  if (resume && startIdx > 0) {
    console.log(`Resuming from index ${startIdx} (${progress.totalProcessed} already processed)`);
  }
  
  // Get artworks to process
  let artworks = await getArtworksToProcess();
  
  // Apply limit if specified
  if (limit && !resume) {
    artworks = artworks.slice(0, limit);
    console.log(`Limited to ${artworks.length} artworks`);
  } else if (limit && resume) {
    // When resuming with limit, calculate remaining
    const remaining = limit - progress.totalProcessed;
    if (remaining <= 0) {
      console.log(`Already processed ${progress.totalProcessed} artworks (limit: ${limit})`);
      return;
    }
    artworks = artworks.slice(0, startIdx + remaining);
    console.log(`Resuming with ${remaining} artworks remaining (limit: ${limit})`);
  }
  
  if (startIdx >= artworks.length) {
    console.log('All artworks already processed!');
    return;
  }
  
  // Open single output file in append mode
  const embeddingsFile = path.join(outputDir, 'embeddings.jsonl');
  const writer = createWriteStream(embeddingsFile, { flags: 'a' });
  
  // Process artworks
  let totalProcessed = progress.totalProcessed;
  let totalSkipped = progress.totalSkipped;
  let totalFailed = progress.totalFailed;
  let lastSaveTime = Date.now();
  const lastRequestTime = { time: 0 };
  
  for (let idx = startIdx; idx < artworks.length; idx++) {
    const artwork = artworks[idx];
    
    const { processed, skipped, failed } = await processArtwork(
      artwork,
      model,
      writer,
      idx,
      artworks.length,
      lastRequestTime
    );
    
    totalProcessed += processed;
    totalSkipped += skipped;
    totalFailed += failed;
    
    // Save progress every 100 artworks or every 30 seconds
    if ((idx + 1) % 100 === 0 || Date.now() - lastSaveTime > 30000) {
      await saveProgress(model, {
        lastProcessedIndex: idx,
        totalProcessed,
        totalSkipped,
        totalFailed,
        lastObjectId: artwork.object_id,
        timestamp: new Date().toISOString()
      });
      lastSaveTime = Date.now();
      
      console.log(`Progress: ${totalProcessed} processed, ${totalSkipped} skipped, ${totalFailed} failed`);
    }
  }
  
  // Final save
  writer.end();
  
  await saveProgress(model, {
    lastProcessedIndex: artworks.length - 1,
    totalProcessed,
    totalSkipped,
    totalFailed,
    lastObjectId: artworks[artworks.length - 1].object_id,
    timestamp: new Date().toISOString()
  });
  
  console.log('\n=== Final Summary ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total skipped: ${totalSkipped}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log(`Output file: ${embeddingsFile}`);
}

if (require.main === module) {
  main().catch(console.error);
}