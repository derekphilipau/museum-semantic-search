#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MoMAParser } from './lib/parsers/moma-parser';
import { ParsedArtwork } from './lib/parsers/types';
import { generateEmbedding } from '../lib/embeddings';
import * as readline from 'readline';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

const MODEL_KEY = 'google_gemini_text';

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

interface EmbeddingRecord {
  artwork_id: string;
  embedding: number[];
  timestamp: string;
  model: string;
  dimension: number;
  text_content: string;
  metadata: {
    title: string;
    artist: string;
    date: string;
    medium: string;
    classification: string;
    department: string;
    culture: string;
    period: string;
    artistBio: string;
    artistNationality: string;
    collection: string;
  };
}

// Load descriptions into a map
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

// Combine metadata with visual descriptions to create text for embedding
function createTextContent(artwork: ParsedArtwork, description: DescriptionRecord): string {
  const metadata = artwork.metadata;
  const parts: string[] = [];
  
  // Primary metadata fields
  if (metadata.title) parts.push(`Title: ${metadata.title}`);
  if (metadata.artist) parts.push(`Artist: ${metadata.artist}`);
  if (metadata.date) parts.push(`Date: ${metadata.date}`);
  if (metadata.medium) parts.push(`Medium: ${metadata.medium}`);
  if (metadata.classification) parts.push(`Type: ${metadata.classification}`);
  if (metadata.department) parts.push(`Department: ${metadata.department}`);
  
  // Artist information
  if (metadata.artistBio) parts.push(`Artist Bio: ${metadata.artistBio}`);
  if (metadata.artistNationality) parts.push(`Artist Nationality: ${metadata.artistNationality}`);
  
  // Cultural context (if relevant)
  if (metadata.culture) parts.push(`Culture: ${metadata.culture}`);
  if (metadata.period) parts.push(`Period: ${metadata.period}`);
  
  // Visual descriptions
  if (description.alt_text) {
    parts.push(`Visual Description: ${description.alt_text}`);
  }
  if (description.long_description) {
    parts.push(`Detailed Visual Description: ${description.long_description}`);
  }
  
  return parts.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const resumeFrom = args.find(arg => arg.startsWith('--resume-from='))?.split('=')[1];
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const skipExisting = args.includes('--skip-existing');
  
  console.log('Google Gemini Text Embeddings Generator for MoMA Collection');
  console.log('=========================================================');
  console.log(`Model: ${MODEL_KEY}`);
  console.log(`Skip existing: ${skipExisting}`);
  console.log(`Resume from: ${resumeFrom || 'start'}`);
  console.log(`Limit: ${limit || 'all artworks with descriptions'}`);
  
  // Parse MoMA CSV
  const parser = new MoMAParser();
  const csvPath = path.join(process.cwd(), 'data', 'moma', 'Artworks_50k.csv');
  
  console.log('\nParsing MoMA CSV...');
  let artworks: ParsedArtwork[];
  try {
    artworks = await parser.parseFile(csvPath);
    console.log(`✓ Parsed ${artworks.length} artworks`);
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    return;
  }
  
  // Load descriptions
  const descriptionsPath = path.join(process.cwd(), 'data', 'descriptions', 'gemini_2_5_flash', 'descriptions.jsonl');
  console.log('\nLoading visual descriptions...');
  const descriptions = await loadDescriptionsMap(descriptionsPath);
  console.log(`✓ Loaded ${descriptions.size} descriptions`);
  
  // Filter artworks to only those with descriptions
  const artworksWithDescriptions = artworks.filter(a => descriptions.has(a.metadata.id));
  console.log(`✓ Found ${artworksWithDescriptions.length} artworks with visual descriptions`);
  
  // Apply limit if specified
  if (limit) {
    artworksWithDescriptions.splice(limit);
    console.log(`✓ Limited to ${artworksWithDescriptions.length} artworks`);
  }
  
  // Sort for consistent ordering
  artworksWithDescriptions.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
  
  // Find start index if resuming
  let startIndex = 0;
  if (resumeFrom) {
    startIndex = artworksWithDescriptions.findIndex(a => a.metadata.id === resumeFrom);
    if (startIndex === -1) {
      console.error(`Could not find artwork ${resumeFrom} to resume from`);
      return;
    }
    console.log(`✓ Resuming from index ${startIndex} (${resumeFrom})`);
  }
  
  // Setup output directory and file
  const outputDir = path.join(process.cwd(), 'data', 'embeddings', MODEL_KEY);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'embeddings.jsonl');
  
  // Load existing embeddings if skipping
  const existingIds = new Set<string>();
  if (skipExisting) {
    try {
      const existing = await fs.readFile(outputPath, 'utf-8');
      const lines = existing.trim().split('\n');
      for (const line of lines) {
        if (line) {
          try {
            const record: EmbeddingRecord = JSON.parse(line);
            existingIds.add(record.artwork_id);
          } catch (e) {
            // Skip invalid lines
          }
        }
      }
      console.log(`✓ Found ${existingIds.size} existing embeddings to skip`);
    } catch (e) {
      console.log('No existing embeddings file found');
    }
  }
  
  // Open file for appending
  const fileHandle = await fs.open(outputPath, 'a');
  
  // Track statistics
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  
  console.log('\nGenerating embeddings...');
  
  for (let i = startIndex; i < artworksWithDescriptions.length; i++) {
    const artwork = artworksWithDescriptions[i];
    const artworkId = artwork.metadata.id;
    const description = descriptions.get(artworkId)!;
    
    // Skip if already exists
    if (skipExisting && existingIds.has(artworkId)) {
      skipped++;
      processed++;
      continue;
    }
    
    try {
      // Create combined text content
      const textContent = createTextContent(artwork, description);
      
      // Generate embedding
      const startTime = Date.now();
      const result = await generateEmbedding(textContent, MODEL_KEY);
      const duration = Date.now() - startTime;
      
      // Create record
      const record: EmbeddingRecord = {
        artwork_id: artworkId,
        embedding: result.embedding,
        timestamp: new Date().toISOString(),
        model: MODEL_KEY,
        dimension: result.dimension,
        text_content: textContent,
        metadata: {
          title: artwork.metadata.title,
          artist: artwork.metadata.artist,
          date: artwork.metadata.date || '',
          medium: artwork.metadata.medium || '',
          classification: artwork.metadata.classification || '',
          department: artwork.metadata.department || '',
          culture: artwork.metadata.culture || '',
          period: artwork.metadata.period || '',
          artistBio: artwork.metadata.artistBio || '',
          artistNationality: artwork.metadata.artistNationality || '',
          collection: artwork.metadata.collection
        }
      };
      
      // Write to file
      await fileHandle.write(JSON.stringify(record) + '\n');
      
      succeeded++;
      console.log(`✓ [${i+1}/${artworksWithDescriptions.length}] ${artworkId} - ${artwork.metadata.title} (${duration}ms)`);
      
      // Rate limiting to avoid overwhelming the API
      if (succeeded % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      failed++;
      console.error(`✗ [${i+1}/${artworksWithDescriptions.length}] ${artworkId} - Error:`, error);
      
      // On error, save progress info
      if (failed === 1) {
        console.log(`\nTo resume from this point, run with --resume-from=${artworkId}`);
      }
      
      // Add exponential backoff on errors
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.min(failed, 10)));
    }
    
    processed++;
    
    // Progress update every 100 items
    if (processed % 100 === 0) {
      console.log(`\nProgress: ${processed}/${artworksWithDescriptions.length} (${succeeded} succeeded, ${failed} failed, ${skipped} skipped)`);
    }
  }
  
  await fileHandle.close();
  
  console.log('\n✅ Complete!');
  console.log(`   Total processed: ${processed}`);
  console.log(`   Succeeded: ${succeeded}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Output: ${outputPath}`);
  
  if (failed > 0) {
    console.log(`\n⚠️  ${failed} embeddings failed. You can resume by running:`);
    console.log(`   npm run generate-text-embeddings -- --resume-from=<artwork_id> --skip-existing`);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}