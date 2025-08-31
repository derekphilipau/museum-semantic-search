#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as path from 'path';

// Load environment variables from .env.local
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

import { esClient, INDEX_NAME, INDEX_MAPPING } from './lib/elasticsearch';
import { CollectionParser } from './lib/parsers/types';
import { MoMAParser } from './lib/parsers/moma-parser';
import { Artwork } from '@/app/types';

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

// Create or recreate the Elasticsearch index
async function createIndex(forceRecreate: boolean = false): Promise<boolean> {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    
    if (exists) {
      if (!forceRecreate) {
        console.log(`Index ${INDEX_NAME} already exists. Use --force to recreate.`);
        return false;
      }
      
      console.log(`Deleting existing index ${INDEX_NAME}...`);
      await esClient.indices.delete({ index: INDEX_NAME });
    }
    
    console.log(`Creating index ${INDEX_NAME}...`);
    await esClient.indices.create({
      index: INDEX_NAME,
      body: INDEX_MAPPING
    });
    
    console.log('Index created successfully');
    return true;
  } catch (error) {
    console.error('Error creating index:', error);
    throw error;
  }
}

// Index artworks in batches
async function indexArtworks(
  parser: CollectionParser,
  filePath: string,
  limit?: number,
  batchSize: number = 100
) {
  console.log(`\nParsing ${parser.getCollectionName()} data...`);
  const parsedArtworks = await parser.parseFile(filePath);
  
  console.log(`Found ${parsedArtworks.length} artworks with images`);
  
  const toIndex = limit ? parsedArtworks.slice(0, limit) : parsedArtworks;
  console.log(`Indexing ${toIndex.length} artworks...`);
  
  let indexed = 0;
  
  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize);
    const operations: any[] = [];
    
    for (const parsed of batch) {
      const { metadata, image } = parsed;
      
      // Extract searchable text
      const searchableText = extractSearchableText(metadata);
      
      // Prepare document
      const doc: Artwork = {
        id: metadata.id,
        metadata,
        image,
        searchableText,
        embeddings: {} // Will be populated by generate-embeddings script
      };
      
      // Add to bulk operation
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
        
        indexed += batch.length;
        console.log(`Indexed ${indexed}/${toIndex.length} artworks`);
      } catch (error) {
        console.error('Bulk indexing error:', error);
        throw error;
      }
    }
  }
  
  console.log('Indexing completed');
}

async function main() {
  const args = process.argv.slice(2);
  const collectionArg = args.find(arg => arg.startsWith('--collection='));
  const collection = collectionArg ? collectionArg.split('=')[1] : 'moma';
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const forceRecreate = args.includes('--force');
  
  try {
    console.log('Artwork Indexing Script');
    console.log('======================');
    console.log('Options:');
    console.log('  --collection=NAME  Collection to index (default: moma)');
    console.log('  --limit=N          Index only N artworks');
    console.log('  --force            Force recreate index (deletes existing data)');
    console.log('');
    
    // Select parser based on collection
    let parser: CollectionParser;
    let filePath: string;
    
    switch (collection.toLowerCase()) {
      case 'moma':
        parser = new MoMAParser();
        filePath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
        break;
      // Add more parsers here as needed
      // case 'met':
      //   parser = new MetParser();
      //   filePath = path.join(process.cwd(), 'data', 'MetObjects.csv');
      //   break;
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
    
    console.log(`Selected collection: ${parser.getCollectionName()}`);
    console.log(`Data file: ${filePath}`);
    
    // Create index
    const indexCreated = await createIndex(forceRecreate);
    
    if (!indexCreated && !forceRecreate) {
      console.log('Skipping indexing - index already exists');
      return;
    }
    
    // Index artworks
    await indexArtworks(parser, filePath, limit);
    
    // Print summary
    const count = await esClient.count({ index: INDEX_NAME });
    console.log(`\nTotal documents in index: ${count.count}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}