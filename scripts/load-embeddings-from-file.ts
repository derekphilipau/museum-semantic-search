#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import { esClient, INDEX_NAME } from './lib/elasticsearch';
import { ModelKey } from '../lib/embeddings/types';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

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

async function updateArtworkEmbedding(
  artworkId: string,
  model: ModelKey,
  embedding: number[]
): Promise<boolean> {
  try {
    await esClient.update({
      index: INDEX_NAME,
      id: artworkId,
      body: {
        doc: {
          embeddings: {
            [model]: embedding
          }
        }
      }
    });
    return true;
  } catch (error) {
    console.error(`Failed to update artwork ${artworkId}:`, error);
    return false;
  }
}

async function processEmbeddingFile(
  filePath: string,
  model: ModelKey,
  batchSize: number = 100
): Promise<{ loaded: number; failed: number }> {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let batch: { id: string; embedding: number[] }[] = [];
  let loaded = 0;
  let failed = 0;
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    
    try {
      const record: EmbeddingRecord = JSON.parse(line);
      
      // Validate record
      if (!record.artwork_id || !record.embedding || !Array.isArray(record.embedding)) {
        console.warn(`Invalid record at line ${lineNumber}`);
        failed++;
        continue;
      }

      batch.push({
        id: record.artwork_id,
        embedding: record.embedding
      });

      // Process batch when it reaches the specified size
      if (batch.length >= batchSize) {
        console.log(`Processing batch of ${batch.length} embeddings...`);
        
        // Use bulk update for efficiency
        const bulkBody = batch.flatMap(item => [
          { update: { _index: INDEX_NAME, _id: item.id } },
          { doc: { embeddings: { [model]: item.embedding } } }
        ]);

        try {
          const bulkResponse = await esClient.bulk({
            body: bulkBody,
            refresh: false
          });

          if (bulkResponse.errors) {
            const errorCount = bulkResponse.items.filter((item: any) => 
              item.update?.error
            ).length;
            failed += errorCount;
            loaded += batch.length - errorCount;
          } else {
            loaded += batch.length;
          }
        } catch (error) {
          console.error('Bulk update failed:', error);
          failed += batch.length;
        }

        batch = [];
        console.log(`Progress: ${loaded} loaded, ${failed} failed`);
      }
    } catch (error) {
      console.error(`Error parsing line ${lineNumber}:`, error);
      failed++;
    }
  }

  // Process remaining items in batch
  if (batch.length > 0) {
    console.log(`Processing final batch of ${batch.length} embeddings...`);
    
    const bulkBody = batch.flatMap(item => [
      { update: { _index: INDEX_NAME, _id: item.id } },
      { doc: { embeddings: { [model]: item.embedding } } }
    ]);

    try {
      const bulkResponse = await esClient.bulk({
        body: bulkBody,
        refresh: false
      });

      if (bulkResponse.errors) {
        const errorCount = bulkResponse.items.filter((item: any) => 
          item.update?.error
        ).length;
        failed += errorCount;
        loaded += batch.length - errorCount;
      } else {
        loaded += batch.length;
      }
    } catch (error) {
      console.error('Final bulk update failed:', error);
      failed += batch.length;
    }
  }

  return { loaded, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const modelArg = args.find(arg => arg.startsWith('--model='));
  const fileArg = args.find(arg => arg.startsWith('--file='));
  const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
  
  if (!modelArg && !fileArg) {
    console.log(`
Load embeddings from file into Elasticsearch

Usage:
  npm run load-embeddings-from-file -- --model=MODEL [--batch-size=N]
  npm run load-embeddings-from-file -- --file=PATH [--batch-size=N]

Options:
  --model=MODEL       Load default file for this model (data/embeddings/MODEL/embeddings.jsonl)
  --file=PATH         Load specific file path
  --batch-size=N      Number of embeddings to update in each batch (default: 100)

Examples:
  npm run load-embeddings-from-file -- --model=jina_embeddings_v4
  npm run load-embeddings-from-file -- --file=data/embeddings/backup/embeddings.jsonl
`);
    process.exit(1);
  }
  
  let filePath: string;
  let model: ModelKey;
  
  if (fileArg) {
    filePath = fileArg.split('=')[1];
    // Try to detect model from file path or first record
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const firstLine = fileContent.split('\n')[0];
    if (firstLine) {
      try {
        const firstRecord: EmbeddingRecord = JSON.parse(firstLine);
        model = firstRecord.model as ModelKey;
        console.log(`Detected model from file: ${model}`);
      } catch {
        console.error('Could not detect model from file. Please use --model option.');
        process.exit(1);
      }
    } else {
      console.error('File is empty');
      process.exit(1);
    }
  } else {
    model = modelArg!.split('=')[1] as ModelKey;
    filePath = path.join(process.cwd(), 'data', 'embeddings', model, 'embeddings.jsonl');
  }
  
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;
  
  // Check if file exists
  try {
    await fs.access(filePath);
  } catch {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  console.log('Load Embeddings from File');
  console.log('========================');
  console.log(`File: ${filePath}`);
  console.log(`Model: ${model}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('');
  
  // Check Elasticsearch connection
  try {
    await esClient.ping();
    console.log('✓ Elasticsearch connected');
  } catch {
    console.error('✗ Elasticsearch not available at', process.env.ELASTICSEARCH_URL || 'http://localhost:9200');
    process.exit(1);
  }
  
  // Check index exists
  const indexExists = await esClient.indices.exists({ index: INDEX_NAME });
  if (!indexExists) {
    console.error(`Index ${INDEX_NAME} does not exist. Run indexing script first.`);
    process.exit(1);
  }
  
  console.log(`✓ Index ${INDEX_NAME} exists`);
  console.log('\nLoading embeddings...\n');
  
  const startTime = Date.now();
  const { loaded, failed } = await processEmbeddingFile(filePath, model, batchSize);
  const duration = (Date.now() - startTime) / 1000;
  
  console.log('\n\nSummary');
  console.log('=======');
  console.log(`Total loaded: ${loaded}`);
  console.log(`Total failed: ${failed}`);
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Rate: ${(loaded / duration).toFixed(1)} embeddings/second`);
  
  if (failed > 0) {
    console.warn(`\n⚠️  ${failed} embeddings failed to load`);
    process.exit(1);
  } else {
    console.log('\n✓ All embeddings loaded successfully!');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}