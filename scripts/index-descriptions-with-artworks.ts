#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Client } from '@elastic/elasticsearch';
import { MoMAParser } from './lib/parsers/moma-parser';
import { ParsedArtwork } from './lib/parsers/types';
import * as readline from 'readline';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

// Elasticsearch client
const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

interface DescriptionRecord {
  artwork_id: string;
  alt_text: string;
  long_description: string;
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

async function loadDescriptionsMap(filePath: string): Promise<Map<string, DescriptionRecord>> {
  const descriptionsMap = new Map<string, DescriptionRecord>();
  
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    
    for (const line of lines) {
      if (line) {
        try {
          const record: DescriptionRecord = JSON.parse(line);
          descriptionsMap.set(record.artwork_id, record);
        } catch (e) {
          console.error('Failed to parse line:', line);
        }
      }
    }
  } catch (error) {
    console.log(`Could not load descriptions from ${filePath}`);
  }
  
  return descriptionsMap;
}

async function updateWithDescriptions(forceRecreate: boolean = false, limit?: number) {
  // Parse MoMA CSV
  const parser = new MoMAParser();
  const csvPath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
  
  console.log('Parsing MoMA CSV...');
  let artworks: ParsedArtwork[];
  try {
    artworks = await parser.parseFile(csvPath);
    console.log(`Found ${artworks.length} artworks`);
    
    // Filter to only those with images
    artworks = artworks.filter(a => a.image?.url);
    console.log(`With images: ${artworks.length}`);
    
    if (limit) {
      artworks = artworks.slice(0, limit);
      console.log(`Limited to: ${artworks.length}`);
    }
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    return;
  }
  
  // Load descriptions
  const descriptionsDir = path.join(process.cwd(), 'data', 'descriptions');
  const descriptionsPath = path.join(descriptionsDir, 'gemini_2_5_flash', 'descriptions.jsonl');
  
  console.log('\nLoading descriptions...');
  const descriptions = await loadDescriptionsMap(descriptionsPath);
  console.log(`✓ Loaded ${descriptions.size} descriptions`);
  
  // Update documents with descriptions
  console.log('\nUpdating artworks with descriptions...');
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (let i = 0; i < artworks.length; i++) {
    const artwork = artworks[i];
    const artworkId = artwork.metadata.id;
    const description = descriptions.get(artworkId);
    
    if (!description) {
      skipped++;
      continue;
    }
    
    try {
      // Update the document with descriptions
      await client.update({
        index: INDEX_NAME,
        id: artworkId,
        body: {
          doc: {
            visual_alt_text: description.alt_text,
            visual_long_description: description.long_description,
            description_metadata: {
              model: description.model,
              generated_at: description.timestamp,
              has_violations: description.has_violations,
              violations: description.violations
            }
          },
          doc_as_upsert: false // Don't create if doesn't exist
        }
      });
      
      updated++;
      
      if (updated % 100 === 0) {
        console.log(`  Updated ${updated} documents...`);
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Document doesn't exist
        skipped++;
      } else {
        console.error(`Error updating ${artworkId}:`, error.message);
        errors++;
      }
    }
  }
  
  console.log('\n✅ Update complete!');
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
}

async function main() {
  const args = process.argv.slice(2);
  const forceRecreate = args.includes('--force');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  
  console.log('Updating Elasticsearch with Visual Descriptions');
  console.log('=============================================');
  console.log(`Index: ${INDEX_NAME}`);
  console.log(`Force recreate: ${forceRecreate}`);
  console.log(`Limit: ${limit || 'all'}`);
  
  // Check if index exists
  try {
    const exists = await client.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      console.error(`\nError: Index '${INDEX_NAME}' does not exist.`);
      console.log('Please run "npm run index-artworks" first to create the index.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to check index:', error);
    process.exit(1);
  }
  
  await updateWithDescriptions(forceRecreate, limit);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}