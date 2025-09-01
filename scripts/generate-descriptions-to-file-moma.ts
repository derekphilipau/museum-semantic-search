#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { MoMAParser } from './lib/parsers/moma-parser';
import { generateVisualDescription, validatePureDescription } from '../lib/descriptions/gemini';
import { ParsedArtwork } from './lib/parsers/types';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

interface Progress {
  lastProcessedIndex: number;
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  totalViolations: number;
  lastArtworkId: string;
  timestamp: string;
}

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

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function loadProgress(progressPath: string): Promise<Progress | null> {
  try {
    const data = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveProgress(progressPath: string, progress: Progress) {
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
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
): Promise<{ processed: number; skipped: number; failed: number; violations: number }> {
  try {
    const imageUrl = artwork.image?.url;
    
    if (!imageUrl) {
      console.log(`  No image URL for ${artwork.metadata.id}`);
      return { processed: 0, skipped: 1, failed: 0, violations: 0 };
    }

    // Download image to temp file
    const tempDir = path.join(process.cwd(), 'tmp');
    await ensureDirectoryExists(tempDir);
    const tempFile = path.join(tempDir, `temp_${Date.now()}.jpg`);
    
    try {
      console.log(`  Downloading image...`);
      const buffer = await downloadWithRetry(imageUrl);
      await fs.writeFile(tempFile, Buffer.from(buffer));
      
      // Generate description with retry for API errors
      console.log(`  Generating visual descriptions...`);
      let result;
      let attempt = 0;
      const maxRetries = 3;
      
      while (attempt < maxRetries) {
        try {
          attempt++;
          result = await generateVisualDescription(tempFile);
          break; // Success, exit retry loop
        } catch (error: any) {
          if (attempt === maxRetries) {
            throw error;
          }
          console.log(`  Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
          const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
          console.log(`  Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
        }
      }
      
      // Clean up temp file
      await fs.unlink(tempFile);
      
      if (result && result.descriptions) {
        // Validate descriptions for metadata leakage
        const altValidation = validatePureDescription(result.descriptions.altText);
        const longValidation = validatePureDescription(result.descriptions.longDescription);
        
        const hasViolations = !altValidation.isValid || !longValidation.isValid;
        const allViolations = [...altValidation.violations, ...longValidation.violations];
        
        if (hasViolations) {
          console.log(`  ⚠️  Metadata violations detected: ${allViolations.join(', ')}`);
        }
        
        const record: DescriptionRecord = {
          artwork_id: artwork.metadata.id,
          alt_text: result.descriptions.altText,
          long_description: result.descriptions.longDescription,
          has_violations: hasViolations,
          violations: allViolations,
          timestamp: result.timestamp,
          model: result.model,
          metadata: {
            title: artwork.metadata.title,
            artist: artwork.metadata.artist,
            date: artwork.metadata.date,
            medium: artwork.metadata.medium,
            collection: artwork.metadata.collection
          }
        };
        
        writer.write(JSON.stringify(record) + '\n');
        console.log(`  ✓ Success (${result.descriptions.altText.split(' ').length} words alt text)`);
        
        return { 
          processed: 1, 
          skipped: 0, 
          failed: 0, 
          violations: hasViolations ? 1 : 0 
        };
      } else {
        console.log(`  ✗ Failed to generate descriptions`);
        return { processed: 0, skipped: 0, failed: 1, violations: 0 };
      }
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  } catch (error: any) {
    console.error(`  ✗ Error: ${error.message}`);
    return { processed: 0, skipped: 0, failed: 1, violations: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const resume = args.includes('--resume');
  const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
  
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 10;
  
  console.log('MoMA Artwork Visual Description Generation');
  console.log('=========================================');
  console.log(`Model: Gemini 2.5 Flash`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log(`Resume: ${resume}`);
  console.log(`Save progress every: ${batchSize} artworks`);
  
  // Check API key
  if (!process.env.GOOGLE_GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.error('\nError: GOOGLE_GEMINI_API_KEY or GOOGLE_API_KEY not set');
    console.log('Please set one of these environment variables in your .env.local file');
    process.exit(1);
  }
  
  // Parse MoMA CSV
  const parser = new MoMAParser();
  const csvPath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
  
  console.log('\nParsing MoMA CSV...');
  let artworks: ParsedArtwork[];
  try {
    artworks = await parser.parseFile(csvPath);
    console.log(`Found ${artworks.length} artworks total`);
    
    // Filter to only those with images
    artworks = artworks.filter(a => a.image?.url);
    console.log(`With images: ${artworks.length}`);
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    process.exit(1);
  }
  
  // Setup output directory
  const outputDir = path.join(process.cwd(), 'data', 'descriptions', 'gemini_2_5_flash');
  await ensureDirectoryExists(outputDir);
  
  const outputPath = path.join(outputDir, 'descriptions.jsonl');
  const progressPath = path.join(outputDir, 'progress.json');
  
  // Load progress if resuming
  let progress: Progress = {
    lastProcessedIndex: -1,
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    totalViolations: 0,
    lastArtworkId: '',
    timestamp: new Date().toISOString()
  };
  
  if (resume) {
    const savedProgress = await loadProgress(progressPath);
    if (savedProgress) {
      progress = savedProgress;
      console.log(`\nResuming from index ${progress.lastProcessedIndex} (artwork ${progress.lastArtworkId})`);
      console.log(`Previously processed: ${progress.totalProcessed}`);
      console.log(`Previously skipped: ${progress.totalSkipped}`);
      console.log(`Previously failed: ${progress.totalFailed}`);
      console.log(`Previously with violations: ${progress.totalViolations}`);
    }
  }
  
  // Open output file
  const writer = createWriteStream(outputPath, { flags: resume ? 'a' : 'w' });
  
  try {
    let processedInSession = 0;
    const startIndex = progress.lastProcessedIndex + 1;
    const endIndex = limit ? Math.min(startIndex + limit, artworks.length) : artworks.length;
    
    console.log(`\nProcessing artworks ${startIndex + 1} to ${endIndex}...\n`);
    
    for (let i = startIndex; i < endIndex; i++) {
      const artwork = artworks[i];
      console.log(`[${i + 1}/${endIndex}] ${artwork.metadata.title} by ${artwork.metadata.artist || 'Unknown'}`);
      
      const result = await processArtwork(artwork, writer);
      
      progress.totalProcessed += result.processed;
      progress.totalSkipped += result.skipped;
      progress.totalFailed += result.failed;
      progress.totalViolations += result.violations;
      progress.lastProcessedIndex = i;
      progress.lastArtworkId = artwork.metadata.id;
      progress.timestamp = new Date().toISOString();
      
      processedInSession += result.processed;
      
      // Save progress periodically
      if ((i - startIndex + 1) % batchSize === 0) {
        await saveProgress(progressPath, progress);
        console.log(`  → Progress saved\n`);
      }
      
      // Rate limiting - Gemini has generous limits but let's be respectful
      // 2000 RPM = ~33 per second, but let's do 10 per second to be safe
      await sleep(100);
    }
    
    // Final progress save
    await saveProgress(progressPath, progress);
    
    console.log('\n\nSummary');
    console.log('=======');
    console.log(`Processed in this session: ${processedInSession}`);
    console.log(`Total processed: ${progress.totalProcessed}`);
    console.log(`Total skipped: ${progress.totalSkipped}`);
    console.log(`Total failed: ${progress.totalFailed}`);
    console.log(`Total with violations: ${progress.totalViolations}`);
    console.log(`\nDescriptions saved to: ${outputPath}`);
    
  } finally {
    writer.end();
  }
  
  // Clean up temp directory
  try {
    const tempDir = path.join(process.cwd(), 'tmp');
    await fs.rmdir(tempDir);
  } catch {}
}

// Add usage function
function showUsage() {
  console.log(`
Generate visual descriptions from MoMA artworks using Gemini 2.5 Flash

Usage:
  npm run generate-descriptions [options]

Options:
  --limit=N         Limit to N artworks (optional)
  --resume          Resume from last checkpoint (optional)
  --batch-size=N    Save progress every N artworks (default: 10)

Output:
  data/descriptions/gemini_2_5_flash/descriptions.jsonl
  data/descriptions/gemini_2_5_flash/progress.json

Example:
  npm run generate-descriptions -- --limit=100
  npm run generate-descriptions -- --resume
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
    console.error('Fatal error:', error);
    process.exit(1);
  });
}