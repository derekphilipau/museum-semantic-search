#!/usr/bin/env node
/**
 * Creates a curated dataset of Met paintings with images (MetPaintingsWithImages.csv)
 * 
 * This script:
 * 1. Reads the full Met collection CSV (480K+ objects)
 * 2. Filters to only public domain paintings
 * 3. Fetches image URLs from the Met API for each painting
 * 4. Outputs only paintings that have images to a new CSV
 * 
 * Features:
 * - Resume capability: can be interrupted and restarted
 * - Exponential backoff for API failures
 * - Rate limiting to respect Met's API
 * - Progress tracking and reporting
 */

import * as fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { parseArgs } from 'util';

type CsvRow = Record<string, string>;

interface MetAPIResponse extends Record<string, unknown> {
  objectID?: number;
  primaryImage?: string;
  primaryImageSmall?: string;
  title?: string;
  artistDisplayName?: string;
  objectDate?: string;
}

class MetAPIFetcher {
  private outputPath: string;
  private tempPath: string;
  private baseDelay: number;
  private consecutive403s = 0;
  private processedIds = new Set<string>();
  private csvHeaders: string[] = [];

  constructor(outputPath: string, delay: number = 2.0) {
    this.outputPath = outputPath;
    this.tempPath = outputPath + '.tmp';
    this.baseDelay = delay;
  }

  async loadExistingData(): Promise<Map<string, CsvRow>> {
    const existing = new Map<string, CsvRow>();
    
    try {
      await fs.access(this.outputPath);
      console.log(`Loading existing data from ${this.outputPath}`);
      
      const parser = createReadStream(this.outputPath)
        .pipe(parse({
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
          bom: true,
          quote: '"',
          escape: '"',
          relax_quotes: true
        }));
      
      for await (const row of parser) {
        const objectId = row['Object ID'];
        if (objectId) {
          existing.set(objectId, row);
          this.processedIds.add(objectId);
        }
      }
      
      console.log(`Loaded ${existing.size} existing paintings with images`);
    } catch {
      console.log('No existing file found, starting fresh');
    }
    
    return existing;
  }

  async fetchWithBackoff(objectId: string, maxRetries: number = 5): Promise<MetAPIResponse | null> {
    const url = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`  Attempt ${attempt + 1}/${maxRetries} for object ${objectId}`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
        
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Museum-Semantic-Search/1.0 (https://github.com/derekphilipau/museum-semantic-search)'
          }
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          console.log(`  ✓ Success: ${response.status}`);
          this.consecutive403s = 0;
          return await response.json();
        } else if (response.status === 429) {
          // Rate limited
          const retryAfter = response.headers.get('Retry-After') || '60';
          console.log(`  ⚠️  Rate limited! Waiting ${retryAfter} seconds...`);
          await this.sleep(parseInt(retryAfter) * 1000);
        } else if (response.status === 403) {
          // Forbidden - likely rate limiting
          this.consecutive403s++;
          const waitTime = Math.min(60 * this.consecutive403s, 300); // Max 5 min wait
          console.log(`  ⚠️  403 Forbidden - likely rate limit. Waiting ${waitTime}s...`);
          await this.sleep(waitTime * 1000);
        } else if (response.status === 404) {
          console.log(`  ✗ Object not found (404)`);
          return null;
        } else {
          const text = await response.text();
          console.log(`  ✗ HTTP ${response.status}: ${text.substring(0, 100)}`);
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            console.log('  ✗ Request timeout');
          } else {
            console.log(`  ✗ Error: ${error.message}`);
          }
        } else {
          console.log('  ✗ Unknown error encountered during fetch');
        }
      }
      
      // Exponential backoff
      if (attempt < maxRetries - 1) {
        const waitTime = this.baseDelay * Math.pow(2, attempt);
        console.log(`  Waiting ${waitTime.toFixed(1)}s before retry...`);
        await this.sleep(waitTime * 1000);
      }
    }
    
    console.log(`  ✗ Failed after ${maxRetries} attempts`);
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async processPaintings(csvPath: string, limit?: number): Promise<void> {
    // Load existing processed data
    const existing = await this.loadExistingData();
    
    // Collect paintings to process
    const paintingsToProcess: Array<{ id: string; row: CsvRow }> = [];
    console.log(`\nReading CSV from ${csvPath}`);
    
    // First pass: collect headers and paintings
    const parser = createReadStream(csvPath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true,
        quote: '"',
        escape: '"',
        relax_quotes: true
      }));
    
    let headersSet = false;
    for await (const row of parser) {
      // Store headers from first row
      if (!headersSet && Object.keys(row).length > 0) {
        this.csvHeaders = Object.keys(row);
        headersSet = true;
      }
      
      if (row['Classification']?.toLowerCase() === 'paintings' &&
          row['Is Public Domain']?.toLowerCase() === 'true' &&
          row['Link Resource']?.trim()) {
        const objectId = row['Object ID'];
        if (objectId && !this.processedIds.has(objectId)) {
          paintingsToProcess.push({ id: objectId, row });
        }
      }
    }
    
    console.log(`\nFound ${paintingsToProcess.length + existing.size} total public domain paintings:`);
    console.log(`  - Already processed with images: ${existing.size}`);
    console.log(`  - To check for images: ${paintingsToProcess.length}`);
    
    if (paintingsToProcess.length === 0) {
      console.log('\nAll paintings already processed!');
      return;
    }
    
    // Apply limit if specified
    let toProcess = paintingsToProcess;
    if (limit && limit < paintingsToProcess.length) {
      toProcess = paintingsToProcess.slice(0, limit);
      console.log(`  - Limited to: ${toProcess.length}`);
    }
    
    // Set up CSV output with image columns added
    const outputHeaders = [...this.csvHeaders, 'primaryImage', 'primaryImageSmall', 'hasImage', 'fetchedAt'];
    
    // If file doesn't exist, write headers
    if (existing.size === 0) {
      const stringifier = stringify({ 
        header: true, 
        columns: outputHeaders,
        quoted: true,  // Quote all fields to handle newlines
        quoted_string: true,
        quoted_empty: true,
        quote: '"',
        escape: '"'
      });
      const writeStream = createWriteStream(this.tempPath);
      stringifier.pipe(writeStream);
      stringifier.end();
      await new Promise<void>(resolve => writeStream.on('finish', resolve));
      await fs.rename(this.tempPath, this.outputPath);
    }
    
    // Process paintings and append those with images
    const stringifier = stringify({ 
      header: false, 
      columns: outputHeaders,
      quoted: true,  // Quote all fields to handle newlines
      quoted_string: true,
      quoted_empty: true,
      quote: '"',
      escape: '"'
    });
    const writeStream = createWriteStream(this.outputPath, { flags: 'a' });
    stringifier.pipe(writeStream);
    
    let paintingsWithImages = 0;
    let paintingsSkipped = 0;
    let failed = 0;
    
    console.log(`\nStarting fetch process (delay: ${this.baseDelay}s between requests)`);
    console.log('='.repeat(60));
    
    for (let i = 0; i < toProcess.length; i++) {
      const { id: objectId, row } = toProcess[i];
      console.log(`\n[${i + 1}/${toProcess.length}] Object ${objectId}`);
      
      // Fetch from API
      const data = await this.fetchWithBackoff(objectId);
      
      if (data === null) {
        failed++;
        console.log(`  ✗ Skipping object ${objectId} (not found in API)`);
        continue;
      }
      
      // Only save paintings that have images
      if (data.primaryImage) {
        // Add image data to the row
        const enhancedRow = {
          ...row,
          primaryImage: data.primaryImage || '',
          primaryImageSmall: data.primaryImageSmall || '',
          hasImage: 'True',
          fetchedAt: new Date().toISOString()
        };
        
        stringifier.write(enhancedRow);
        paintingsWithImages++;
        console.log(`  ✓ Has image: ${data.title?.substring(0, 50) || row['Title']?.substring(0, 50)}...`);
      } else {
        paintingsSkipped++;
        console.log(`  ✗ No image: ${data.title?.substring(0, 50) || row['Title']?.substring(0, 50)}...`);
      }
      
      // Progress summary every 50 items
      if ((i + 1) % 50 === 0) {
        console.log(`\nProgress: ${i + 1}/${toProcess.length}`);
        console.log(`  With images (saved): ${paintingsWithImages}`);
        console.log(`  Without images (skipped): ${paintingsSkipped}`);
        console.log('='.repeat(60));
      }
      
      // Rate limiting delay
      if (i < toProcess.length - 1) {
        await this.sleep(this.baseDelay * 1000);
      }
    }
    
    // Close the stream
    stringifier.end();
    await new Promise<void>(resolve => writeStream.on('finish', resolve));
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed: ${toProcess.length}`);
    console.log(`With images (saved): ${paintingsWithImages}`);
    console.log(`Without images (skipped): ${paintingsSkipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`\nOutput saved to: ${this.outputPath}`);
    console.log(`Total paintings with images: ${existing.size + paintingsWithImages}`);
  }
}

async function main() {
  // Parse command line arguments
  const { values } = parseArgs({
    options: {
      limit: {
        type: 'string',
        short: 'l',
      },
      delay: {
        type: 'string',
        short: 'd',
      },
      help: {
        type: 'boolean',
        short: 'h',
      }
    }
  });
  
  if (values.help) {
    console.log(`
Met Museum Paintings Dataset Creator

This script creates a curated dataset of Met paintings with verified image URLs.

What it does:
1. Reads the full Met CSV (480K+ objects)
2. Filters to public domain paintings only (~5K)
3. Fetches image URLs from Met API for each painting
4. Outputs ONLY paintings with images to MetPaintingsWithImages.csv

Usage: npm run 1-create-paintings-dataset -- [options]

Options:
  -l, --limit <number>  Limit number of paintings to check
  -d, --delay <number>  Delay between requests in seconds (default: 2.0)
  -h, --help           Show help

Examples:
  # Process all paintings (will take ~3 hours at 2s delay)
  npm run 1-create-paintings-dataset
  
  # Test with first 10 paintings
  npm run 1-create-paintings-dataset -- --limit 10
  
  # Use slower rate if getting 403s
  npm run 1-create-paintings-dataset -- --delay 3.0
  
  # Resume after interruption (automatic - just run again)
  npm run 1-create-paintings-dataset

Resume capability:
- The script automatically resumes from where it left off
- Already processed paintings are skipped
- Safe to interrupt with Ctrl+C and restart later

Output: data/met/MetPaintingsWithImages.csv
- Contains all original CSV columns PLUS:
  - primaryImage: Full resolution image URL
  - primaryImageSmall: Web-friendly image URL  
  - hasImage: Always 'True' (paintings without images are excluded)
  - fetchedAt: Timestamp when fetched
`);
    process.exit(0);
  }
  
  const limit = values.limit ? parseInt(values.limit) : undefined;
  const delay = values.delay ? parseFloat(values.delay) : 2.0;
  
  // Paths
  const csvPath = path.join(__dirname, '../../data/met/MetObjects.csv');
  const outputPath = path.join(__dirname, '../../data/met/MetPaintingsWithImages.csv');
  
  // Check CSV exists
  try {
    await fs.access(csvPath);
  } catch {
    console.error(`Error: CSV not found at ${csvPath}`);
    console.error('Please ensure Met data is downloaded to data/met/');
    process.exit(1);
  }
  
  console.log('Met Museum Paintings Dataset Creator');
  console.log('='.repeat(60));
  console.log(`Delay between requests: ${delay}s`);
  console.log(`Output file: ${outputPath}`);
  
  // Create fetcher and process
  const fetcher = new MetAPIFetcher(outputPath, delay);
  await fetcher.processPaintings(csvPath, limit);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
