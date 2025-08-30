#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import readline from 'readline';
import { esClient, INDEX_NAME, INDEX_MAPPING } from './lib/elasticsearch';
import { parseMetObjectsCSV } from './parse-met-csv';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

interface EmbeddingRecord {
  object_id: number;
  embedding: number[];
  timestamp: string;
  model: string;
  dimension: number;
}

interface EmbeddingsMap {
  [objectId: number]: {
    jina_embeddings_v4?: number[];
    google_vertex_multimodal?: number[];
  };
}

async function loadEmbeddings(): Promise<EmbeddingsMap> {
  const embeddings: EmbeddingsMap = {};
  const embeddingsDir = path.join(process.cwd(), 'data', 'embeddings');
  
  // Check which models have embeddings
  let modelDirs: string[] = [];
  try {
    modelDirs = await fs.readdir(embeddingsDir);
  } catch {
    console.log('No embeddings directory found');
    return embeddings;
  }
  
  for (const modelDir of modelDirs) {
    const modelPath = path.join(embeddingsDir, modelDir);
    const stat = await fs.stat(modelPath);
    
    if (!stat.isDirectory()) continue;
    
    console.log(`Loading embeddings for ${modelDir}...`);
    
    // Check for single embeddings file first
    const embeddingsFile = path.join(modelPath, 'embeddings.jsonl');
    let loaded = 0;
    
    try {
      await fs.access(embeddingsFile);
      // New single-file format
      const fileStream = createReadStream(embeddingsFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        try {
          const record: EmbeddingRecord = JSON.parse(line);
          
          if (!embeddings[record.object_id]) {
            embeddings[record.object_id] = {};
          }
          
          embeddings[record.object_id][modelDir as keyof EmbeddingsMap[number]] = record.embedding;
          loaded++;
        } catch (error) {
          console.error(`Error parsing embedding record: ${error}`);
        }
      }
    } catch {
      // Fall back to batch files for backwards compatibility
      const files = await fs.readdir(modelPath);
      const batchFiles = files.filter(f => f.startsWith('batch_') && f.endsWith('.jsonl')).sort();
      
      for (const batchFile of batchFiles) {
        const filePath = path.join(modelPath, batchFile);
        const fileStream = createReadStream(filePath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        for await (const line of rl) {
          try {
            const record: EmbeddingRecord = JSON.parse(line);
            
            if (!embeddings[record.object_id]) {
              embeddings[record.object_id] = {};
            }
            
            embeddings[record.object_id][modelDir as keyof EmbeddingsMap[number]] = record.embedding;
            loaded++;
          } catch (error) {
            console.error(`Error parsing embedding record: ${error}`);
          }
        }
      }
    }
    
    console.log(`  Loaded ${loaded} embeddings for ${modelDir}`);
  }
  
  return embeddings;
}

async function createIndex(forceRecreate: boolean = false) {
  console.log(`Checking index: ${INDEX_NAME}`);
  
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    
    if (exists) {
      if (!forceRecreate) {
        console.log('Index already exists. Use --force to recreate it.');
        return false;
      }
      console.log('Index already exists, deleting (--force specified)...');
      await esClient.indices.delete({ index: INDEX_NAME });
    }
    
    await esClient.indices.create({
      index: INDEX_NAME,
      body: INDEX_MAPPING,
    });
    
    console.log('Index created successfully');
    return true;
  } catch (error) {
    console.error('Error creating index:', error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const forceRecreate = args.includes('--force');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  
  console.log('Met Museum Artwork Indexing with Pre-computed Embeddings');
  console.log('======================================================');
  console.log('Options:');
  console.log('  --force      Force recreate index (deletes existing data)');
  console.log('  --limit=N    Index only N artworks');
  console.log('');
  
  // Load embeddings first
  console.log('Loading pre-computed embeddings...');
  const embeddingsMap = await loadEmbeddings();
  console.log(`Total artworks with embeddings: ${Object.keys(embeddingsMap).length}`);
  
  // Create index
  const indexCreated = await createIndex(forceRecreate);
  if (!indexCreated) {
    console.log('\nSkipping indexing since index already exists.');
    console.log('Use --force to recreate the index and reindex all data.');
    return;
  }
  
  // Load artworks from CSV
  console.log('\nLoading artworks from CSV...');
  const artworks = await parseMetObjectsCSV();
  console.log(`Found ${artworks.length} artworks from selected departments with images`);
  
  // Index artworks with embeddings
  console.log('\nIndexing artworks...');
  const BATCH_SIZE = 100;
  let indexed = 0;
  let skipped = 0;
  
  const toIndex = limit ? artworks.slice(0, limit) : artworks;
  
  for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
    const batch = toIndex.slice(i, i + BATCH_SIZE);
    const operations = [];
    
    for (const artwork of batch) {
      // Check if we have embeddings for this artwork
      const embeddings = embeddingsMap[artwork.object_id] || {};
      
      // Skip if no embeddings (optional - you might want to index anyway)
      if (Object.keys(embeddings).length === 0) {
        skipped++;
        continue;
      }
      
      // Extract searchable text
      const searchableText = [
        artwork.title,
        artwork.artist,
        artwork.artist_bio,
        artwork.department,
        artwork.culture,
        artwork.period,
        artwork.object_date,
        artwork.medium,
        ...(artwork.tags || [])
      ].filter(Boolean).join(' ');
      
      const boostedKeywords = [
        artwork.title,
        artwork.title, // Double weight
        artwork.artist,
        artwork.artist,
        ...(artwork.tags || [])
      ].filter(Boolean).join(' ');
      
      // Prepare document
      const doc = {
        id: artwork.object_id.toString(),
        metadata: {
          objectId: artwork.object_id,
          title: artwork.title || 'Untitled',
          artist: artwork.artist || 'Unknown',
          artistBio: artwork.artist_bio || '',
          department: artwork.department || '',
          culture: artwork.culture || '',
          period: artwork.period || '',
          dateCreated: artwork.object_date || '',
          dateBegin: artwork.object_begin_date || null,
          dateEnd: artwork.object_end_date || null,
          medium: artwork.medium || '',
          dimensions: artwork.dimensions || '',
          creditLine: artwork.credit_line || '',
          tags: artwork.tags || [],
          hasImage: true,
          isPublicDomain: artwork.is_public_domain,
          isHighlight: artwork.is_highlight || false
        },
        image: artwork.filename,
        searchableText,
        boostedKeywords,
        embeddings
      };
      
      operations.push(
        { index: { _index: INDEX_NAME, _id: doc.id } },
        doc
      );
    }
    
    // Execute bulk operation
    if (operations.length > 0) {
      try {
        const bulkResponse = await esClient.bulk({ operations });
        
        if (bulkResponse.errors) {
          const erroredDocuments = bulkResponse.items.filter((item: any) => 
            item.index?.error
          );
          console.error('Bulk operation errors:', erroredDocuments);
        }
        
        indexed += operations.length / 2; // Divide by 2 because each doc has 2 operations
        console.log(`Indexed ${indexed}/${toIndex.length} artworks`);
      } catch (error) {
        console.error('Bulk indexing error:', error);
        throw error;
      }
    }
  }
  
  // Refresh index
  await esClient.indices.refresh({ index: INDEX_NAME });
  
  // Get count
  const count = await esClient.count({ index: INDEX_NAME });
  
  console.log('\n=== Summary ===');
  console.log(`Total documents indexed: ${count.count}`);
  console.log(`Skipped (no embeddings): ${skipped}`);
  console.log('\nIndexing complete!');
  console.log('\nNext step: npm run dev');
}

if (require.main === module) {
  main().catch(console.error);
}