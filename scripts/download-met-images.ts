#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import https from 'https';
import { createWriteStream } from 'fs';

// Load environment variables from .env.local
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

import { parse } from 'csv-parse';
import { createReadStream } from 'fs';


interface MetAPIResponse {
  objectID: number;
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  additionalImages: string[];
  title: string;
  artistDisplayName: string;
}

interface PublicDomainArtwork {
  object_id: number;
  title: string;
  artist: string;
  is_public_domain: boolean;
  department: string;
}

// Departments we want to include - focused on high-quality art collections
const ALLOWED_DEPARTMENTS = [
  'European Paintings',
  'Greek and Roman Art',
  'Egyptian Art',
  'Asian Art',
  'Islamic Art',
  'Medieval Art',
  'Ancient Near Eastern Art'
];

async function downloadImage(url: string, filepath: string): Promise<boolean> {
  // For optimal model performance and web delivery, we should resize to 512x512
  // TODO: Add image resizing to 512x512 during download
  // For now, downloading full size - consider using Sharp library for resizing
  return new Promise((resolve) => {
    const file = createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        console.error(`Failed to download ${url}: ${response.statusCode}`);
        file.close();
        fs.unlink(filepath).catch(() => {}); // Delete failed download
        resolve(false);
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      
      file.on('error', (err) => {
        console.error(`Error writing file: ${err}`);
        fs.unlink(filepath).catch(() => {});
        resolve(false);
      });
    }).on('error', (err) => {
      console.error(`Error downloading: ${err}`);
      file.close();
      fs.unlink(filepath).catch(() => {});
      resolve(false);
    });
  });
}

async function fetchMetObjectData(objectId: number, retryCount = 0): Promise<MetAPIResponse | null> {
  const url = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`;
  const maxRetries = 3;
  
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', async () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } else if (res.statusCode === 429 || res.statusCode === 503) {
            // Rate limit or service unavailable - retry with exponential backoff
            if (retryCount < maxRetries) {
              const backoffTime = Math.pow(2, retryCount) * 30000; // 30s, 60s, 120s
              console.log(`  ⏱️  Rate limited. Waiting ${backoffTime/1000}s before retry ${retryCount + 1}/${maxRetries}...`);
              await new Promise(r => setTimeout(r, backoffTime));
              const result = await fetchMetObjectData(objectId, retryCount + 1);
              resolve(result);
            } else {
              console.log(`  ❌ Max retries reached for object ${objectId}`);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (err) {
          console.error(`Error parsing JSON for object ${objectId}:`, err);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.error(`Error fetching object ${objectId}:`, err);
      resolve(null);
    });
  });
}

async function getExistingImages(): Promise<Set<number>> {
  const existingImages = new Set<number>();
  
  try {
    // Check all image directories
    const imageDirs = [
      path.join(process.cwd(), 'data', 'images', 'original'),
      path.join(process.cwd(), 'data', 'images', 'fullsize'),
      path.join(process.cwd(), 'data', 'images', '2048'),
      path.join(process.cwd(), 'data', 'images', '1024'),
      path.join(process.cwd(), 'data', 'images', '512'),
      path.join(process.cwd(), 'data', 'met_artworks') // Keep checking legacy location
    ];
    
    for (const dir of imageDirs) {
      const files = await fs.readdir(dir).catch(() => []);
      
      for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
          // Handle both new format (123.jpg) and old format (123_artist.jpg)
          const objectId = parseInt(file.split(/[_.]/, 2)[0]);
          if (!isNaN(objectId)) {
            existingImages.add(objectId);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error reading existing images:', error);
  }
  
  return existingImages;
}


// Removed sanitizeFilename - no longer needed with simple numeric filenames

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;
  const delayArg = args.find(arg => arg.startsWith('--delay='));
  const delay = delayArg ? parseInt(delayArg.split('=')[1]) : 1000; // Default 1 second between API calls
  const allArg = args.includes('--all');
  
  console.log('Met Museum Image Downloader');
  console.log('===========================');
  console.log(`Options:`);
  if (allArg) {
    console.log(`  --all (download ALL public domain images from selected departments)`);
  } else {
    console.log(`  --limit=${limit} (number of images to download)`);
  }
  console.log(`  --delay=${delay}ms (delay between API calls)`);
  console.log('');
  console.log('Filtering by 7 departments:');
  console.log('European Paintings, Greek and Roman, Egyptian, Asian,');
  console.log('Islamic, Medieval, Ancient Near Eastern');
  console.log('');
  
  // Create images directory if it doesn't exist
  const imagesDir = path.join(process.cwd(), 'data', 'images', 'original');
  await fs.mkdir(imagesDir, { recursive: true });
  
  // Get existing images
  console.log('Checking existing images...');
  const existingImages = await getExistingImages();
  console.log(`Found ${existingImages.size} existing images`);
  
  // Load all public domain artworks from CSV
  console.log('\nLoading public domain artworks from CSV...');
  const publicDomainArtworks: PublicDomainArtwork[] = [];
  
  await new Promise<void>((resolve, reject) => {
    const csvPath = path.join(process.cwd(), 'data', 'MetObjects.csv');
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relaxColumnCount: true,
      skipRecordsWithError: true
    });
    
    let totalRows = 0;
    let publicDomainCount = 0;
    
    parser.on('readable', function() {
      let record: any;
      while ((record = parser.read()) !== null) {
        totalRows++;
        
        // Only include public domain artworks from allowed departments
        if (record['Is Public Domain'] === 'True' && 
            ALLOWED_DEPARTMENTS.includes(record['Department'])) {
          publicDomainCount++;
          const objectId = parseInt(record['Object ID']);
          
          // Skip if we already have this image
          if (!existingImages.has(objectId)) {
            publicDomainArtworks.push({
              object_id: objectId,
              title: record['Title'] || 'Untitled',
              artist: record['Artist Display Name'] || 'Unknown',
              is_public_domain: true,
              department: record['Department']
            });
          }
        }
        
        // Progress update
        if (totalRows % 50000 === 0) {
          console.log(`  Processed ${totalRows} rows...`);
        }
      }
    });
    
    parser.on('error', function(err) {
      console.error('CSV parsing error:', err);
      reject(err);
    });
    
    parser.on('end', function() {
      console.log(`  Total rows: ${totalRows}`);
      console.log(`  Public domain artworks in selected departments: ${publicDomainCount}`);
      console.log(`  Without images: ${publicDomainArtworks.length}`);
      resolve();
    });
    
    // Start parsing
    createReadStream(csvPath).pipe(parser);
  });
  
  if (publicDomainArtworks.length === 0) {
    console.log('\nAll public domain artworks already have images!');
    return;
  }
  
  // Limit the number to process
  const artworks = allArg ? publicDomainArtworks : publicDomainArtworks.slice(0, limit);
  console.log(`\nWill download images for ${artworks.length} artworks`);
  
  if (allArg) {
    const estimatedHours = (artworks.length * delay / 1000 / 60 / 60).toFixed(1);
    console.log(`⏱️  Estimated time: ${estimatedHours} hours`);
    console.log(`💡 Tip: You can interrupt (Ctrl+C) and resume anytime - already downloaded images will be skipped`);
  }
  
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();
  let consecutiveFailures = 0;
  let currentDelay = delay;
  
  // Save progress every 100 downloads
  const progressFile = path.join(process.cwd(), 'data', 'download-progress.json');
  let lastSavedProgress = 0;
  
  for (let i = 0; i < artworks.length; i++) {
    const artwork = artworks[i];
    const objectId = artwork.object_id;
    
    // Progress indicator with ETA
    const elapsedTime = Date.now() - startTime;
    const avgTimePerItem = elapsedTime / (i + 1);
    const remainingItems = artworks.length - i - 1;
    const etaMs = remainingItems * avgTimePerItem;
    const etaHours = (etaMs / 1000 / 60 / 60).toFixed(1);
    
    console.log(`\n[${i + 1}/${artworks.length}] Processing object ${objectId}... (ETA: ${etaHours}h)`);
    
    // Fetch object data from Met API
    const metData = await fetchMetObjectData(objectId);
    
    if (!metData) {
      console.log(`  ⚠️  Failed to fetch API data`);
      failed++;
      consecutiveFailures++;
      
      // If we have many consecutive failures, increase delay
      if (consecutiveFailures >= 5) {
        currentDelay = Math.min(currentDelay * 2, 10000); // Double delay, max 10s
        console.log(`  🔄 Too many failures. Increasing delay to ${currentDelay}ms`);
      }
      continue;
    }
    
    // Reset consecutive failures on success
    consecutiveFailures = 0;
    if (currentDelay > delay) {
      currentDelay = Math.max(currentDelay * 0.9, delay); // Gradually reduce back to normal
    }
    
    if (!metData.isPublicDomain) {
      console.log(`  ⚠️  Not public domain`);
      skipped++;
      continue;
    }
    
    if (!metData.primaryImage) {
      console.log(`  ⚠️  No primary image available`);
      skipped++;
      continue;
    }
    
    // Download the image - simple filename with just object ID
    const filename = `${objectId}.jpg`;
    const filepath = path.join(imagesDir, filename);
    
    // Use primary image for best quality (we'll resize later)
    const imageUrl = metData.primaryImage;
    
    console.log(`  📥 Downloading: ${filename}`);
    console.log(`     From: ${imageUrl}`);
    
    const success = await downloadImage(imageUrl, filepath);
    
    if (success) {
      console.log(`  ✅ Downloaded successfully`);
      downloaded++;
    } else {
      console.log(`  ❌ Download failed`);
      failed++;
    }
    
    // Save progress periodically
    if (downloaded > 0 && downloaded % 100 === 0 && downloaded !== lastSavedProgress) {
      const progress = {
        lastProcessedIndex: i,
        downloaded,
        failed,
        skipped,
        totalArtworks: artworks.length,
        timestamp: new Date().toISOString()
      };
      await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
      lastSavedProgress = downloaded;
      console.log(`  💾 Progress saved (${downloaded} downloaded so far)`);
    }
    
    // Delay between requests to be respectful to the API
    if (i < artworks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000 / 60 / 60).toFixed(1);
  
  console.log('\n=============================');
  console.log(`Download Summary:`);
  console.log(`  ✅ Successfully downloaded: ${downloaded}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped (no image): ${skipped}`);
  console.log(`  📁 Images saved to: ${imagesDir}`);
  console.log(`  ⏱️  Total time: ${totalTime} hours`);
  console.log('\nNext steps:');
  console.log('1. Re-run: npm run index-artworks (to index newly downloaded images)');
  console.log('2. Run: npm run generate-embeddings');
  console.log('3. Continue downloading more: npm run download-images --limit=100');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export {};