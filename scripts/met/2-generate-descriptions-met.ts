#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import * as readline from 'readline';
import { MetParser } from '../lib/parsers/met-parser';
import { generateVisualDescription } from '../../lib/descriptions/gemini';
import { ParsedArtwork } from '../lib/parsers/types';

// Load environment variables
const projectDir = path.join(__dirname, '../..');
loadEnvConfig(projectDir);

interface DescriptionRecord {
  artwork_id: string;
  alt_text: string;
  long_description: string;
  emoji_summary: string;
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

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function loadExistingArtworkIds(jsonlPath: string): Promise<Set<string>> {
  const existingIds = new Set<string>();
  
  try {
    await fs.access(jsonlPath);
  } catch {
    // File doesn't exist yet, return empty set
    return existingIds;
  }
  
  const fileStream = createReadStream(jsonlPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        const record: DescriptionRecord = JSON.parse(line);
        existingIds.add(record.artwork_id);
      } catch (error) {
        console.error('Error parsing existing record:', error);
      }
    }
  }
  
  return existingIds;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadWithRetry(url: string, maxRetries: number = 3): Promise<ArrayBuffer> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error: any) {
      console.log(`  Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`  Waiting ${waitTime}ms before retry...`);
      await sleep(waitTime);
    }
  }
  throw new Error('Failed after all retries');
}

async function processArtwork(
  artwork: ParsedArtwork,
  writer: any
): Promise<{ success: boolean; reason?: string }> {
  try {
    const imageUrl = typeof artwork.image === 'string' ? artwork.image : artwork.image?.url;
    
    if (!imageUrl) {
      return { success: false, reason: 'No image URL' };
    }

    // Download image
    console.log(`  Downloading from: ${imageUrl}`);
    const imageArrayBuffer = await downloadWithRetry(imageUrl);
    const imageBuffer = Buffer.from(imageArrayBuffer);
    
    // Get unique filename
    const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
    const tempFile = path.join('/tmp', `met_${artwork.id}_${Date.now()}.${ext}`);
    
    await fs.writeFile(tempFile, imageBuffer);
    console.log(`  Image saved to: ${tempFile} (${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    
    // Generate description
    console.log('  Generating description...');
    const result = await generateVisualDescription(tempFile);
    
    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch (error) {
      console.error('  Warning: Failed to delete temp file:', error);
    }
    
    if (!result) {
      return { success: false, reason: 'Failed to generate description' };
    }
    
    // Validate that we actually got description content
    if (!result.descriptions || !result.descriptions.altText || !result.descriptions.longDescription || !result.descriptions.emojiSummary) {
      console.error('  Invalid description result - missing required fields:');
      console.error(`    alt_text: ${result.descriptions?.altText ? 'present' : 'MISSING'}`);
      console.error(`    long_description: ${result.descriptions?.longDescription ? 'present' : 'MISSING'}`);
      console.error(`    emoji_summary: ${result.descriptions?.emojiSummary ? 'present' : 'MISSING'}`);
      return { success: false, reason: 'Generated description missing required fields' };
    }
    
    // Additional validation - check for reasonable content
    if (result.descriptions.altText.length < 5 || result.descriptions.longDescription.length < 50) {
      console.error('  Invalid description result - content too short:');
      console.error(`    alt_text length: ${result.descriptions.altText.length} (min: 5)`);
      console.error(`    long_description length: ${result.descriptions.longDescription.length} (min: 50)`);
      return { success: false, reason: 'Generated description too short' };
    }
    
    // Create record
    const record: DescriptionRecord = {
      artwork_id: artwork.id,
      alt_text: result.descriptions.altText,
      long_description: result.descriptions.longDescription,
      emoji_summary: result.descriptions.emojiSummary,
      timestamp: result.timestamp || new Date().toISOString(),
      model: result.model || 'gemini-2.5-flash',
      metadata: {
        title: artwork.title || '',
        artist: artwork.artist || '',
        date: artwork.date || '',
        medium: artwork.medium || '',
        collection: 'Metropolitan Museum of Art'
      }
    };
    
    // Write immediately
    return new Promise((resolve) => {
      writer.write(JSON.stringify(record) + '\n', (err: any) => {
        if (err) {
          console.error('  Failed to write record:', err);
          resolve({ success: false, reason: 'Write failed' });
        } else {
          console.log(`  ✓ Saved description for ${artwork.id}`);
          resolve({ success: true });
        }
      });
    });
    
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

interface Options {
  limit?: number;
  batchSize: number;
  artworkIds?: string[];
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: Options = {
    batchSize: 10 // Default batch size for rate limiting
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--artwork-ids' && args[i + 1]) {
      options.artworkIds = args[i + 1].split(',');
      i++;
    }
  }
  
  const outputDir = path.join(process.cwd(), 'data', 'met', 'descriptions', 'gemini_2_5_flash');
  const outputFile = path.join(outputDir, 'descriptions.jsonl');
  
  await ensureDirectoryExists(outputDir);
  
  // Load existing artwork IDs
  console.log('Loading existing descriptions...');
  const existingIds = await loadExistingArtworkIds(outputFile);
  console.log(`Found ${existingIds.size} existing descriptions`);
  
  // Open output file in append mode
  const writer = createWriteStream(outputFile, { flags: 'a' });
  
  // Load and process artworks
  const parser = new MetParser();
  const csvPath = path.join(process.cwd(), 'data', 'met', 'MetPaintingsWithImages.csv');
  const artworks = await parser.parseFile(csvPath);
  
  console.log(`\nTotal artworks available: ${artworks.length}`);
  console.log(`Limit: ${options.limit || 'none'}`);
  console.log(`Batch size: ${options.batchSize}`);
  if (options.artworkIds) {
    console.log(`Specific artwork IDs: ${options.artworkIds.join(', ')}`);
  }
  
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let batchCount = 0;
  
  for (let i = 0; i < artworks.length; i++) {
    const artwork = artworks[i];
    
    // Check if we've hit the limit
    if (options.limit && totalProcessed >= options.limit) {
      console.log(`\nReached limit of ${options.limit} artworks`);
      break;
    }
    
    // Skip if already processed
    if (existingIds.has(artwork.id)) {
      totalSkipped++;
      continue;
    }
    
    // Skip if specific IDs requested and this isn't one
    if (options.artworkIds && !options.artworkIds.includes(artwork.id)) {
      continue;
    }
    
    console.log(`\n[${totalProcessed + 1}] Processing ${artwork.id}: ${artwork.title} by ${artwork.artist || 'Unknown'}`);
    
    const result = await processArtwork(artwork, writer);
    
    if (result.success) {
      totalProcessed++;
      batchCount++;
      
      // Rate limiting
      if (batchCount >= options.batchSize) {
        console.log(`\n--- Completed batch of ${options.batchSize}, waiting 1s for rate limiting ---`);
        await sleep(1000);
        batchCount = 0;
      }
    } else {
      totalFailed++;
      console.log(`  ✗ Failed: ${result.reason}`);
    }
  }
  
  // Close the writer
  writer.end();
  
  console.log('\n\nSUMMARY');
  console.log('=======');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total skipped (already exists): ${totalSkipped}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log(`\nDescriptions saved to: ${outputFile}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}