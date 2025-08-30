#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { esClient, INDEX_NAME } from './lib/elasticsearch';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

async function copyIndexedImages() {
  console.log('Fetching indexed artworks from Elasticsearch...');
  
  // Get all indexed documents
  const searchResponse = await esClient.search({
    index: INDEX_NAME,
    size: 10000,
    _source: ['image', 'metadata.objectId'],
  });
  
  const documents = searchResponse.hits.hits;
  console.log(`Found ${documents.length} indexed artworks`);
  
  // Create public/images directory if it doesn't exist
  const publicImagesDir = path.join(process.cwd(), 'public', 'images');
  await fs.mkdir(publicImagesDir, { recursive: true });
  
  // Copy images
  let copied = 0;
  let notFound = 0;
  
  for (const doc of documents) {
    const artwork = doc._source as any;
    const objectId = artwork.metadata.objectId;
    const imageName = artwork.image;
    
    if (!imageName) {
      console.log(`No image for artwork ${objectId}`);
      continue;
    }
    
    const sourcePath = path.join(process.cwd(), 'data', 'images', 'huggingface', imageName);
    const destPath = path.join(publicImagesDir, imageName);
    
    try {
      await fs.copyFile(sourcePath, destPath);
      copied++;
      if (copied % 10 === 0) {
        console.log(`Copied ${copied} images...`);
      }
    } catch (error) {
      console.error(`Failed to copy ${imageName}: ${error}`);
      notFound++;
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total indexed artworks: ${documents.length}`);
  console.log(`Images copied: ${copied}`);
  console.log(`Images not found: ${notFound}`);
  console.log(`\nImages copied to: ${publicImagesDir}`);
}

async function main() {
  try {
    await copyIndexedImages();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}