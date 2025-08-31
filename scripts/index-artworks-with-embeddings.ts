#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import { MoMAParser } from './lib/parsers/moma-parser';
import { ParsedArtwork } from './lib/parsers/types';
import { esClient, INDEX_NAME, INDEX_MAPPING } from './lib/elasticsearch';
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

// Extract searchable text from metadata
function extractSearchableText(metadata: any): string {
  const fields = [
    metadata.title,
    metadata.artist,
    metadata.date,
    metadata.medium,
    metadata.department,
    metadata.classification,
    metadata.culture,
    metadata.period,
    metadata.artistBio,
    metadata.artistNationality,
    metadata.creditLine
  ];
  
  return fields
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Load embeddings from JSONL file into a map
async function loadEmbeddingsMap(filePath: string): Promise<Map<string, number[]>> {
  const embeddingsMap = new Map<string, number[]>();
  
  try {
    await fs.access(filePath);
  } catch {
    console.log(`Embeddings file not found: ${filePath}`);
    return embeddingsMap;
  }
  
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    try {
      const record: EmbeddingRecord = JSON.parse(line);
      embeddingsMap.set(record.artwork_id, record.embedding);
      count++;
    } catch (error) {
      console.warn('Failed to parse embedding record:', error);
    }
  }
  
  console.log(`Loaded ${count} embeddings from ${path.basename(filePath)}`);
  return embeddingsMap;
}

async function indexArtworks(
  artworks: ParsedArtwork[],
  embeddings: Record<ModelKey, Map<string, number[]>>,
  limit?: number
) {
  const batchSize = 100;
  const totalToIndex = limit ? Math.min(limit, artworks.length) : artworks.length;
  
  console.log(`\nIndexing ${totalToIndex} artworks...`);
  
  let indexed = 0;
  let failed = 0;
  
  for (let i = 0; i < totalToIndex; i += batchSize) {
    const batch = artworks.slice(i, Math.min(i + batchSize, totalToIndex));
    const bulkBody = [];
    
    for (const artwork of batch) {
      // Build embeddings object for this artwork
      const artworkEmbeddings: Record<string, number[]> = {};
      
      for (const [model, embeddingMap] of Object.entries(embeddings)) {
        const embedding = embeddingMap.get(artwork.metadata.id);
        if (embedding) {
          artworkEmbeddings[model] = embedding;
        }
      }
      
      // Create the document
      const doc = {
        id: artwork.metadata.id,
        metadata: artwork.metadata,
        image: artwork.image,
        searchableText: extractSearchableText(artwork.metadata),
        embeddings: artworkEmbeddings
      };
      
      bulkBody.push(
        { index: { _index: INDEX_NAME, _id: artwork.metadata.id } },
        doc
      );
    }
    
    // Bulk index
    try {
      const bulkResponse = await esClient.bulk({
        body: bulkBody,
        refresh: false
      });
      
      if (bulkResponse.errors) {
        const errorCount = bulkResponse.items.filter((item: any) => 
          item.index?.error
        ).length;
        failed += errorCount;
        indexed += batch.length - errorCount;
        
        // Log specific errors
        bulkResponse.items.forEach((item: any, idx: number) => {
          if (item.index?.error) {
            console.error(`Failed to index ${batch[idx].id}:`, item.index.error);
          }
        });
      } else {
        indexed += batch.length;
      }
      
      console.log(`Progress: ${indexed + failed}/${totalToIndex} (${indexed} indexed, ${failed} failed)`);
    } catch (error) {
      console.error('Bulk indexing failed:', error);
      failed += batch.length;
    }
  }
  
  // Final refresh to make documents searchable
  await esClient.indices.refresh({ index: INDEX_NAME });
  
  return { indexed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const forceRecreate = args.includes('--force');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  
  console.log('MoMA Artwork Indexing with Pre-computed Embeddings');
  console.log('=================================================');
  console.log(`Force recreate: ${forceRecreate}`);
  console.log(`Limit: ${limit || 'all'}`);
  
  // Check Elasticsearch connection
  try {
    await esClient.ping();
    console.log('✓ Elasticsearch connected');
  } catch {
    console.error('✗ Elasticsearch not available');
    process.exit(1);
  }
  
  // Check if index exists
  const indexExists = await esClient.indices.exists({ index: INDEX_NAME });
  
  if (indexExists && !forceRecreate) {
    console.log(`\nIndex ${INDEX_NAME} already exists. Use --force to recreate.`);
    process.exit(0);
  }
  
  if (forceRecreate && indexExists) {
    console.log(`\nDeleting existing index ${INDEX_NAME}...`);
    await esClient.indices.delete({ index: INDEX_NAME });
  }
  
  // Create index
  console.log(`\nCreating index ${INDEX_NAME}...`);
  await esClient.indices.create({
    index: INDEX_NAME,
    body: INDEX_MAPPING
  });
  console.log('✓ Index created');
  
  // Parse MoMA CSV
  const parser = new MoMAParser();
  const csvPath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
  
  console.log('\nParsing MoMA CSV...');
  let artworks: ParsedArtwork[];
  try {
    artworks = await parser.parseFile(csvPath);
    console.log(`✓ Parsed ${artworks.length} artworks`);
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    process.exit(1);
  }
  
  // Load embeddings
  console.log('\nLoading embeddings...');
  const embeddingsDir = path.join(process.cwd(), 'data', 'embeddings');
  
  const embeddings: Record<string, Map<string, number[]>> = {};
  
  // Load Jina embeddings if available
  const jinaPath = path.join(embeddingsDir, 'jina_embeddings_v4', 'embeddings.jsonl');
  embeddings['jina_embeddings_v4'] = await loadEmbeddingsMap(jinaPath);
  
  // Load Google embeddings if available
  const googlePath = path.join(embeddingsDir, 'google_vertex_multimodal', 'embeddings.jsonl');
  embeddings['google_vertex_multimodal'] = await loadEmbeddingsMap(googlePath);
  
  // Count how many artworks have embeddings
  const artworksWithEmbeddings = new Set<string>();
  for (const embeddingMap of Object.values(embeddings)) {
    for (const artworkId of embeddingMap.keys()) {
      artworksWithEmbeddings.add(artworkId);
    }
  }
  console.log(`\nTotal artworks with embeddings: ${artworksWithEmbeddings.size}`);
  
  // Index artworks
  const startTime = Date.now();
  const { indexed, failed } = await indexArtworks(artworks, embeddings, limit);
  const duration = (Date.now() - startTime) / 1000;
  
  console.log('\n\nSummary');
  console.log('=======');
  console.log(`Total indexed: ${indexed}`);
  console.log(`Total failed: ${failed}`);
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Rate: ${(indexed / duration).toFixed(1)} artworks/second`);
  
  if (failed > 0) {
    console.warn(`\n⚠️  ${failed} artworks failed to index`);
    process.exit(1);
  } else {
    console.log('\n✓ All artworks indexed successfully!');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}