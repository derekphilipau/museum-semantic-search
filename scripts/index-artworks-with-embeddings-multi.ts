#!/usr/bin/env node
import * as path from 'path';

// Load environment variables FIRST before any other imports
const projectDir = path.join(__dirname, '..');
// Set NODE_ENV if not already set
if (!process.env.NODE_ENV) {
  // @ts-expect-error - NODE_ENV is readonly but we need to set it
  process.env.NODE_ENV = 'development';
}

// Manually load env vars
import { loadEnvConfig } from '@next/env';
const { combinedEnv } = loadEnvConfig(projectDir, false); // false = don't log

// Debug: Check if env vars were loaded
console.log('Environment variables loaded:', {
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL?.substring(0, 30) + '...',
  ELASTICSEARCH_API_KEY: process.env.ELASTICSEARCH_API_KEY ? 'SET' : 'NOT SET',
  ELASTICSEARCH_INDEX: process.env.ELASTICSEARCH_INDEX
});

// Now import everything else
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import { MoMAParser } from './lib/parsers/moma-parser';
import { MetParser } from './lib/parsers/met-parser';
import { BaseParser, ParsedArtwork } from './lib/parsers/types';
import { createElasticsearchClient, INDEX_NAME, INDEX_MAPPING } from './lib/elasticsearch';
import { ModelKey, EMBEDDING_MODELS } from '../lib/embeddings/types';

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

interface DescriptionRecord {
  artwork_id: string;
  alt_text: string;
  long_description: string;
  emoji_summary?: string;  // Optional for backward compatibility
  has_violations: boolean;
  violations: string[];
  timestamp: string;
  model: string;
  metadata: {
    title: string;
    artist: string;
    date: string;
    medium: string;
    collection: string;
  };
}

// Collection configuration
interface CollectionConfig {
  name: string;
  parser: BaseParser;
  csvPath: string;
  dataDir: string;
}

const COLLECTIONS: Record<string, CollectionConfig> = {
  moma: {
    name: 'MoMA',
    parser: new MoMAParser(),
    csvPath: 'data/moma/Artworks_50k.csv',
    dataDir: 'data/moma'
  },
  met: {
    name: 'Met',
    parser: new MetParser(),
    csvPath: 'data/met/MetObjects.csv',
    dataDir: 'data/met'
  }
};

// Load embeddings from JSONL file into a map
async function loadEmbeddingsMap(filePath: string): Promise<Map<string, EmbeddingRecord>> {
  const embeddings = new Map<string, EmbeddingRecord>();
  
  try {
    await fs.access(filePath);
  } catch {
    console.log(`  No embeddings file found at ${filePath}`);
    return embeddings;
  }
  
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    try {
      const record = JSON.parse(line) as EmbeddingRecord;
      embeddings.set(record.artwork_id, record);
    } catch (error) {
      console.error('Failed to parse embedding record:', error);
    }
  }
  
  return embeddings;
}

// Load descriptions from JSONL file into a map
async function loadDescriptionsMap(filePath: string): Promise<Map<string, DescriptionRecord>> {
  const descriptions = new Map<string, DescriptionRecord>();
  
  try {
    await fs.access(filePath);
  } catch {
    console.log(`  No descriptions file found at ${filePath}`);
    return descriptions;
  }
  
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    try {
      const record = JSON.parse(line) as DescriptionRecord;
      descriptions.set(record.artwork_id, record);
    } catch (error) {
      console.error('Failed to parse description record:', error);
    }
  }
  
  return descriptions;
}

async function createIndex(esClient: any, forceRecreate: boolean = false) {
  const exists = await esClient.indices.exists({ index: INDEX_NAME });
  
  if (exists) {
    if (!forceRecreate) {
      console.log(`Index "${INDEX_NAME}" already exists. Use --force to recreate.`);
      return false;
    }
    
    console.log(`Deleting existing index "${INDEX_NAME}"...`);
    await esClient.indices.delete({ index: INDEX_NAME });
  }
  
  console.log(`Creating index "${INDEX_NAME}"...`);
  await esClient.indices.create({
    index: INDEX_NAME,
    ...INDEX_MAPPING
  });
  
  return true;
}

async function indexArtworks(
  esClient: any,
  artworks: ParsedArtwork[], 
  embeddings: { [key in ModelKey]?: Map<string, EmbeddingRecord> },
  descriptions: Map<string, DescriptionRecord>
) {
  const BATCH_SIZE = 100;
  let indexed = 0;
  let failed = 0;
  
  for (let i = 0; i < artworks.length; i += BATCH_SIZE) {
    const batch = artworks.slice(i, i + BATCH_SIZE);
    const operations = [];
    
    for (const artwork of batch) {
      const artworkId = artwork.metadata.id;
      
      // Get embeddings for this artwork
      const artworkEmbeddings: any = {};
      for (const [modelKey, embeddingMap] of Object.entries(embeddings)) {
        const embedding = embeddingMap?.get(artworkId);
        if (embedding) {
          artworkEmbeddings[modelKey] = embedding.embedding;
        }
      }
      
      // Get description for this artwork
      const description = descriptions.get(artworkId);
      
      // Create document with proper structure matching Artwork interface
      const doc: any = {
        id: artworkId,
        metadata: artwork.metadata,
        image: artwork.image,
        embeddings: artworkEmbeddings,
        indexed_at: new Date().toISOString()
      };
      
      // Add visual descriptions if available (as separate fields, not nested)
      if (description) {
        doc.visual_alt_text = description.alt_text;
        doc.visual_long_description = description.long_description;
        doc.visual_emoji_summary = description.emoji_summary;
        
        // Parse emojis into array for better search
        if (description.emoji_summary) {
          // Extract individual emojis using Unicode property escapes
          const emojiMatches = description.emoji_summary.match(/\p{Emoji}/gu);
          doc.visual_emoji_array = emojiMatches || [];
        }
        
        doc.description_metadata = {
          model: description.model,
          generated_at: description.timestamp,
          has_violations: description.has_violations,
          violations: description.violations
        };
      }
      
      operations.push(
        { index: { _index: INDEX_NAME, _id: artworkId } },
        doc
      );
    }
    
    try {
      const response = await esClient.bulk({
        operations,
        refresh: false
      });
      
      if (response.errors) {
        for (const item of response.items) {
          if (item.index?.error) {
            console.error(`Failed to index ${item.index._id}:`, item.index.error);
            failed++;
          } else {
            indexed++;
          }
        }
      } else {
        indexed += batch.length;
      }
      
      console.log(`Indexed ${indexed} / ${artworks.length} artworks...`);
    } catch (error) {
      console.error('Bulk indexing error:', error);
      failed += batch.length;
    }
  }
  
  // Final refresh
  await esClient.indices.refresh({ index: INDEX_NAME });
  
  return { indexed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const forceRecreate = args.includes('--force');
  
  // Parse collection (support both --collection met and --collection=met)
  let collection = 'moma'; // default
  const collectionArg = args.find(arg => arg.startsWith('--collection'));
  if (collectionArg) {
    if (collectionArg.includes('=')) {
      collection = collectionArg.split('=')[1].toLowerCase();
    } else {
      const collectionIndex = args.indexOf('--collection');
      if (collectionIndex !== -1 && args[collectionIndex + 1]) {
        collection = args[collectionIndex + 1].toLowerCase();
      }
    }
  }
  
  // Validate collection
  if (!COLLECTIONS[collection]) {
    console.error(`Error: Unknown collection "${collection}"`);
    console.log(`Available collections: ${Object.keys(COLLECTIONS).join(', ')}`);
    process.exit(1);
  }
  
  // Parse --limit (support both --limit 100 and --limit=100)
  let limit: number | undefined;
  const limitArg = args.find(arg => arg.startsWith('--limit'));
  if (limitArg) {
    if (limitArg.includes('=')) {
      limit = parseInt(limitArg.split('=')[1]);
    } else {
      const limitIndex = args.indexOf('--limit');
      if (limitIndex !== -1 && args[limitIndex + 1]) {
        limit = parseInt(args[limitIndex + 1]);
      }
    }
  }
  
  const config = COLLECTIONS[collection];
  
  console.log(`${config.name} Artwork Indexing with Pre-computed Embeddings`);
  console.log('=================================================');
  console.log(`Collection: ${collection}`);
  console.log(`Force recreate: ${forceRecreate}`);
  console.log(`Limit: ${limit || 'all'}`);
  
  // Create Elasticsearch client AFTER env vars are loaded
  const esClient = createElasticsearchClient();
  
  // Check connection
  try {
    const health = await esClient.cluster.health();
    console.log(`\nElasticsearch cluster health: ${health.status}`);
  } catch (error) {
    console.error('\nFailed to connect to Elasticsearch:', error);
    console.log('\nMake sure Elasticsearch is running:');
    console.log('  docker-compose up -d');
    process.exit(1);
  }
  
  // Create or check index
  const indexCreated = await createIndex(esClient, forceRecreate);
  if (!indexCreated && !forceRecreate) {
    console.log('\nExiting. No changes made.');
    return;
  }
  
  // Wait a moment for index to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Verify index exists
  const indexExists = await esClient.indices.exists({ index: INDEX_NAME });
  if (!indexExists) {
    console.error('Index creation failed - index does not exist');
    return;
  }
  
  console.log('✓ Index created');
  
  // Parse CSV
  const csvPath = path.join(process.cwd(), config.csvPath);
  
  console.log(`\nParsing ${config.name} CSV...`);
  let artworks: ParsedArtwork[];
  try {
    artworks = await config.parser.parseFile(csvPath, limit);
    console.log(`Found ${artworks.length} artworks with images`);
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    process.exit(1);
  }
  
  // Load embeddings for each model
  console.log('\nLoading pre-computed embeddings...');
  const embeddings: { [key in ModelKey]?: Map<string, EmbeddingRecord> } = {};
  
  for (const modelKey of Object.keys(EMBEDDING_MODELS) as ModelKey[]) {
    const embeddingPath = path.join(
      process.cwd(), 
      config.dataDir,
      'embeddings',
      modelKey,
      'embeddings.jsonl'
    );
    console.log(`\nLoading ${modelKey} embeddings...`);
    embeddings[modelKey] = await loadEmbeddingsMap(embeddingPath);
    console.log(`  Loaded ${embeddings[modelKey]?.size || 0} ${modelKey} embeddings`);
  }
  
  // Load descriptions
  console.log('\nLoading AI-generated descriptions...');
  const descriptionsPath = path.join(
    process.cwd(),
    config.dataDir,
    'descriptions',
    'gemini_2_5_flash',
    'descriptions.jsonl'
  );
  const descriptions = await loadDescriptionsMap(descriptionsPath);
  console.log(`  Loaded ${descriptions.size} descriptions`);
  
  // Check coverage
  console.log('\nEmbedding coverage:');
  for (const [modelKey, embeddingMap] of Object.entries(embeddings)) {
    if (embeddingMap) {
      const coverage = artworks.filter(a => embeddingMap.has(a.metadata.id)).length;
      console.log(`  ${modelKey}: ${coverage}/${artworks.length} (${(coverage/artworks.length*100).toFixed(1)}%)`);
    }
  }
  
  const descCoverage = artworks.filter(a => descriptions.has(a.metadata.id)).length;
  console.log(`  descriptions: ${descCoverage}/${artworks.length} (${(descCoverage/artworks.length*100).toFixed(1)}%)`);
  
  // Index artworks
  console.log('\nIndexing artworks...');
  const { indexed, failed } = await indexArtworks(esClient, artworks, embeddings, descriptions);
  
  console.log('\n✅ Indexing complete!');
  console.log(`   Indexed: ${indexed}`);
  console.log(`   Failed: ${failed}`);
  
  // Get final stats
  const stats = await esClient.count({ index: INDEX_NAME });
  console.log(`\nTotal documents in index: ${stats.count}`);
}

// Add usage function
function showUsage() {
  console.log(`
Index museum artworks with pre-computed embeddings

Usage:
  npm run index-artworks [options]

Options:
  --collection NAME  Collection to index (moma, met) - default: moma
  --force           Force recreate the index (WARNING: deletes all data)
  --limit N         Limit to N artworks

Examples:
  npm run index-artworks -- --collection moma
  npm run index-artworks -- --collection met --limit 100
  npm run index-artworks -- --force --collection met
`);
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
    process.exit(0);
  }
  
  main().catch(error => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}