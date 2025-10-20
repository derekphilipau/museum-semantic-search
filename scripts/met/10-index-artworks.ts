#!/usr/bin/env node
import * as path from 'path';

// Load environment variables FIRST before any other imports
const projectDir = path.join(__dirname, '../..');
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
import { MetParser } from '../lib/parsers/met-parser';
import { ParsedArtwork } from '../lib/parsers/types';
import { createElasticsearchClient, INDEX_NAME, buildIndexMapping } from '../lib/elasticsearch';
import { ModelKey, EMBEDDING_MODELS } from '../../lib/embeddings';

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

interface ProjectionRecord {
  artwork_id: string;
  embedding_type: string;
  projection_type: string;
  coordinates: number[];
  timestamp: string;
}

interface ProjectionData {
  [embeddingType: string]: {
    [projectionType: string]: number[];
  };
}

interface DescriptionRecord {
  artwork_id: string;
  alt_text: string;
  long_description: string;
  emoji_summary?: string;  // Optional for backward compatibility
  timestamp: string;
  model: string;
  metadata: {
    title: string;
    artist: string;
    date: string;
    medium: string;
    collection: string;
  };
  // For edited descriptions
  changes_made?: string[];
  edited_timestamp?: string;
  edited_model?: string;
}

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

function inferEmbeddingDimension(map?: Map<string, EmbeddingRecord>): number | undefined {
  if (!map || map.size === 0) {
    return undefined;
  }

  for (const record of map.values()) {
    if (record?.dimension && Number.isFinite(record.dimension)) {
      return record.dimension;
    }

    if (record?.embedding && record.embedding.length > 0) {
      return record.embedding.length;
    }
  }

  return undefined;
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

async function loadProjections(): Promise<Map<string, ProjectionData>> {
  console.log('Loading projection files...');
  const projectionsMap = new Map<string, ProjectionData>();
  
  const projectionsDir = path.join(process.cwd(), 'data', 'met', 'projections');
  const embeddingTypes = ['jina_text', 'jina_clip'];
  const projectionTypes = ['standard_2d', 'tight_2d', 'loose_2d', 'standard_3d'];
  
  for (const embeddingType of embeddingTypes) {
    const embeddingDir = path.join(projectionsDir, embeddingType);
    
    // Check if directory exists
    try {
      await fs.access(embeddingDir);
    } catch {
      console.log(`  Skipping ${embeddingType} projections - directory not found`);
      continue;
    }
    
    for (const projectionType of projectionTypes) {
      const filePath = path.join(embeddingDir, `${projectionType}.jsonl`);
      
      try {
        await fs.access(filePath);
        console.log(`  Loading ${embeddingType}/${projectionType}.jsonl...`);
        
        const fileStream = createReadStream(filePath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        let count = 0;
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const record = JSON.parse(line) as ProjectionRecord;
              const artworkId = record.artwork_id;
              
              // Initialize structure if needed
              if (!projectionsMap.has(artworkId)) {
                projectionsMap.set(artworkId, {});
              }
              const artworkProjections = projectionsMap.get(artworkId)!;
              
              if (!artworkProjections[embeddingType]) {
                artworkProjections[embeddingType] = {};
              }
              
              // Store coordinates
              artworkProjections[embeddingType][projectionType] = record.coordinates;
              count++;
            } catch (error) {
              console.warn(`  Failed to parse line: ${line.substring(0, 50)}...`);
            }
          }
        }
        
        console.log(`    Loaded ${count} projections`);
      } catch {
        // File doesn't exist, skip silently
      }
    }
  }
  
  console.log(`  Total artworks with projections: ${projectionsMap.size}`);
  return projectionsMap;
}

async function createIndex(
  esClient: any,
  forceRecreate: boolean = false,
  dims: { text?: number; clip?: number } = {}
) {
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
  const indexMapping = buildIndexMapping({
    textDims: dims.text,
    clipDims: dims.clip,
  });
  await esClient.indices.create({
    index: INDEX_NAME,
    ...indexMapping
  });
  
  return true;
}

async function indexArtworks(
  esClient: any,
  artworks: ParsedArtwork[], 
  embeddings: { [key in ModelKey]?: Map<string, EmbeddingRecord> },
  descriptions: Map<string, DescriptionRecord>,
  projections: Map<string, ProjectionData>
) {
  const BATCH_SIZE = 100;
  let indexed = 0;
  let failed = 0;
  
  for (let i = 0; i < artworks.length; i += BATCH_SIZE) {
    const batch = artworks.slice(i, i + BATCH_SIZE);
    const operations = [];
    
    for (const artwork of batch) {
      const artworkId = artwork.id;
      
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
      
      // Get projections for this artwork
      const artworkProjections = projections.get(artworkId);
      
      // Create document - artwork is already flattened from parser
      const doc: any = {
        // Spread all artwork fields (already flattened)
        ...artwork,
        
        // Add/override specific fields
        id: artworkId,
        embeddings: artworkEmbeddings,
        indexed_at: new Date().toISOString()
      };
      
      // Add projections if available
      if (artworkProjections) {
        doc.projections = artworkProjections;
        doc.projection_metadata = {
          last_updated: new Date().toISOString()
        };
      }
      
      // Add visual descriptions in container if available
      if (description) {
        doc.visual_description = {
          alt_text: description.alt_text,
          long_description: description.long_description,
          emoji_summary: description.emoji_summary,
          emoji_array: description.emoji_summary ? 
            description.emoji_summary.match(/\p{Emoji}/gu) || [] : [],
          metadata: {
            model: description.model,
            generated_at: description.timestamp,
            edited_model: description.edited_model,
            edited_at: description.edited_timestamp,
            changes_made: description.changes_made
          }
        };
      }
      
      // Combined text for search (include all titles if available)
      const allTitlesText = artwork.titles ? artwork.titles.join(' ') : artwork.title;
      doc.searchText = [
        allTitlesText,
        artwork.artist,
        artwork.date,
        artwork.medium,
        artwork.department,
        artwork.culture,
        artwork.classification,
        artwork.objectName,
        artwork.period,
        artwork.dynasty,
        artwork.tags?.join(' '),
        artwork.city,
        artwork.country,
        artwork.region,
        description?.alt_text,
        description?.long_description,
        description?.emoji_summary
      ].filter(Boolean).join(' ');
      
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
  
  console.log('Met Museum Artwork Indexing');
  console.log('===========================');
  console.log(`Force recreate: ${forceRecreate}`);
  console.log(`Limit: ${limit || 'all'}`);
  
  // Connect to Elasticsearch
  console.log('\nConnecting to Elasticsearch...');
  const esClient = createElasticsearchClient();
  
  try {
    const health = await esClient.cluster.health({});
    console.log(`✅ Connected to cluster: ${health.cluster_name}`);
  } catch (error) {
    console.error('Failed to connect to Elasticsearch:', error);
    console.log('\nMake sure Elasticsearch is running:');
    console.log('  docker-compose up -d');
    process.exit(1);
  }

  // Pre-load embeddings so we can detect vector dimensions before creating the index
  console.log('\nLoading pre-computed embeddings (for mapping)...');
  const embeddings: { [key in ModelKey]?: Map<string, EmbeddingRecord> } = {};

  for (const modelKey of Object.keys(EMBEDDING_MODELS) as ModelKey[]) {
    const embeddingPath = path.join(
      process.cwd(),
      'data',
      'met',
      'embeddings',
      modelKey,
      'embeddings.jsonl'
    );
    console.log(`  Loading ${modelKey} embeddings from ${embeddingPath}...`);
    embeddings[modelKey] = await loadEmbeddingsMap(embeddingPath);
    console.log(
      `    Loaded ${embeddings[modelKey]?.size || 0} ${modelKey} embeddings`
    );
  }

  const detectedTextDims = inferEmbeddingDimension(embeddings.jina_text);
  const detectedClipDims = inferEmbeddingDimension(embeddings.jina_clip);
  if (detectedTextDims) {
    process.env.JINA_TEXT_EMBED_DIM = String(detectedTextDims);
  }
  if (detectedClipDims) {
    process.env.JINA_CLIP_EMBED_DIM = String(detectedClipDims);
  }
  console.log('  Embedding dimensions detected:', {
    jina_text: detectedTextDims ?? 'unknown',
    jina_clip: detectedClipDims ?? 'unknown',
  });
  
  // Create or check index
  const indexCreated = await createIndex(esClient, forceRecreate, {
    text: detectedTextDims,
    clip: detectedClipDims,
  });
  if (!indexCreated && !forceRecreate) {
    console.log('\nExiting. Use --force to recreate the index.');
    process.exit(0);
  }
  
  // Parse Met Paintings CSV
  console.log('\nParsing Met Museum paintings...');
  const parser = new MetParser();
  const csvPath = path.join(process.cwd(), 'data', 'met', 'MetPaintingsWithImages.csv');
  const artworks = await parser.parseFile(csvPath, limit);
  console.log(`Parsed ${artworks.length} artworks`);
  
  if (artworks.length === 0) {
    console.log('No artworks found. Make sure to run: npm run 1-fetch-met-images');
    process.exit(1);
  }
  
  // Load descriptions - prioritize edited descriptions
  console.log('\nLoading AI-generated descriptions...');
  
  // First, load original descriptions
  const descriptionsPath = path.join(
    process.cwd(),
    'data',
    'met',
    'descriptions',
    'gemini_2_5_flash',
    'descriptions.jsonl'
  );
  const originalDescriptions = await loadDescriptionsMap(descriptionsPath);
  console.log(`  Loaded ${originalDescriptions.size} original descriptions`);
  
  // Then, load edited descriptions and override originals
  const editedDescriptionsPath = path.join(
    process.cwd(),
    'data',
    'met',
    'descriptions',
    'gemini_2_5_flash',
    'edited_descriptions.jsonl'
  );
  const editedDescriptions = await loadDescriptionsMap(editedDescriptionsPath);
  console.log(`  Loaded ${editedDescriptions.size} edited descriptions`);
  
  // Merge: edited descriptions override original ones
  const descriptions = new Map(originalDescriptions);
  for (const [id, editedDesc] of editedDescriptions) {
    descriptions.set(id, editedDesc);
  }
  console.log(`  Total descriptions available: ${descriptions.size} (${editedDescriptions.size} edited)`);
  
  // Check coverage
  console.log('\nEmbedding coverage:');
  for (const [modelKey, embeddingMap] of Object.entries(embeddings)) {
    if (embeddingMap) {
      const coverage = artworks.filter(a => embeddingMap.has(a.id)).length;
      console.log(`  ${modelKey}: ${coverage}/${artworks.length} (${(coverage/artworks.length*100).toFixed(1)}%)`);
    }
  }
  
  const descCoverage = artworks.filter(a => descriptions.has(a.id)).length;
  console.log(`  descriptions: ${descCoverage}/${artworks.length} (${(descCoverage/artworks.length*100).toFixed(1)}%)`);
  
  // Load projections
  console.log('\nLoading projections...');
  const projections = await loadProjections();
  
  // Index artworks
  console.log('\nIndexing artworks...');
  const { indexed, failed } = await indexArtworks(esClient, artworks, embeddings, descriptions, projections);
  
  console.log('\n✅ Indexing complete!');
  console.log(`   Indexed: ${indexed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${artworks.length}`);
  
  // Close the client
  await esClient.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}
