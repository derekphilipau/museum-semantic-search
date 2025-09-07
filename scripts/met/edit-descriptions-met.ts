#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import * as readline from 'readline';
import { editVisualDescription, VisualDescription } from '../../lib/descriptions/gemini';

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

interface EditedDescriptionRecord extends DescriptionRecord {
  changes_made: string[];
  edited_timestamp: string;
  edited_model: string;
  original_record: DescriptionRecord;
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
        const record: EditedDescriptionRecord = JSON.parse(line);
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


async function processDescription(
  record: DescriptionRecord,
  writer: any
): Promise<{ success: boolean; edited: boolean; reason?: string }> {
  try {
    // Validate record has required fields
    if (!record.alt_text || !record.long_description || !record.emoji_summary) {
      console.error('  Record missing required description fields');
      console.error('    alt_text:', record.alt_text ? 'present' : 'MISSING');
      console.error('    long_description:', record.long_description ? 'present' : 'MISSING');
      console.error('    emoji_summary:', record.emoji_summary ? 'present' : 'MISSING');
      return { success: false, edited: false, reason: 'Record missing required fields' };
    }
    
    // Debug: Log the description being processed
    console.log('  Description to edit:');
    console.log(`    alt_text (${record.alt_text.length} chars): "${record.alt_text.substring(0, 50)}..."`);
    console.log(`    long_description (${record.long_description.length} chars): "${record.long_description.substring(0, 50)}..."`);
    console.log(`    emoji_summary: "${record.emoji_summary}"`);
    console.log('  Metadata:', JSON.stringify(record.metadata, null, 2));
    
    // Prepare the current description
    const currentDescription: VisualDescription = {
      altText: record.alt_text,
      longDescription: record.long_description,
      emojiSummary: record.emoji_summary
    };
    
    // Try to edit with retries
    let result = null;
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`  Editing description... (attempt ${attempt}/${maxRetries})`);
        result = await editVisualDescription(currentDescription, record.metadata);
        
        if (result) {
          break; // Success!
        }
      } catch (error: any) {
        lastError = error;
        console.error(`  Attempt ${attempt} failed: ${error.message}`);
        
        // Check if it's a content policy violation
        if (error.message?.includes('PROHIBITED_CONTENT') || 
            error.message?.includes('blocked due to OTHER') ||
            error.response?.promptFeedback?.blockReason) {
          console.error('  ⚠️  Content blocked by Gemini safety filters');
          console.error('  This artwork contains content that triggers AI safety policies');
          // Don't retry for content violations
          break;
        }
        
        if (attempt < maxRetries) {
          // Longer delays for overloaded API
          const waitTime = Math.min(5000 * Math.pow(2, attempt - 1), 30000); // 5s, 10s, 30s
          console.log(`  Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
        }
      }
    }
    
    if (!result) {
      const errorMsg = lastError ? lastError.message : 'Failed to edit description';
      if (errorMsg.includes('PROHIBITED_CONTENT')) {
        return { success: false, edited: false, reason: 'Content blocked by safety filters - artwork contains sensitive content' };
      }
      return { success: false, edited: false, reason: `Failed after ${maxRetries} attempts: ${errorMsg}` };
    }
    
    // Check if there were any changes
    const changes: string[] = [];
    
    // Debug: Check what we got back
    console.log('  Edit result:', {
      hasDescriptions: !!result.descriptions,
      hasAltText: !!result.descriptions?.altText,
      hasLongDescription: !!result.descriptions?.longDescription,
      hasEmojiSummary: !!result.descriptions?.emojiSummary,
      hasChangesMade: !!result.descriptions?.changesMade,
    });
    
    // Access the nested descriptions object
    const edited = result.descriptions;
    
    try {
      if (edited.altText && record.alt_text && edited.altText !== record.alt_text) {
        const oldWords = record.alt_text.split(/\s+/).length;
        const newWords = edited.altText.split(/\s+/).length;
        changes.push(`alt_text: ${oldWords} → ${newWords} words`);
      }
    } catch (e) {
      console.error('  Error comparing alt_text:', e);
    }
    
    if (edited.longDescription && record.long_description && edited.longDescription !== record.long_description) {
      changes.push(`long_description: ${record.long_description.length} → ${edited.longDescription.length} chars`);
    }
    
    if (edited.emojiSummary && record.emoji_summary && edited.emojiSummary !== record.emoji_summary) {
      changes.push(`emoji: "${record.emoji_summary}" → "${edited.emojiSummary}"`);
    }
    
    if (changes.length === 0) {
      return { success: true, edited: false, reason: 'No changes needed' };
    }
    
    // Create edited record
    const editedRecord: EditedDescriptionRecord = {
      artwork_id: record.artwork_id,
      alt_text: edited.altText,
      long_description: edited.longDescription,
      emoji_summary: edited.emojiSummary,
      timestamp: record.timestamp,
      model: record.model,
      metadata: record.metadata,
      changes_made: changes,
      edited_timestamp: new Date().toISOString(),
      edited_model: result.model || 'gemini-2.5-flash',
      original_record: record
    };
    
    // Write immediately
    return new Promise((resolve) => {
      writer.write(JSON.stringify(editedRecord) + '\n', (err: any) => {
        if (err) {
          console.error('  Failed to write record:', err);
          resolve({ success: false, edited: false, reason: 'Write failed' });
        } else {
          console.log(`  ✓ Saved edited description for ${record.artwork_id}`);
          console.log(`    Changes: ${changes.join(', ')}`);
          resolve({ success: true, edited: true });
        }
      });
    });
    
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return { success: false, edited: false, reason: error.message };
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
    batchSize: 50 // Default batch size for rate limiting
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
  
  const inputFile = path.join(process.cwd(), 'data', 'met', 'descriptions', 'gemini_2_5_flash', 'descriptions.jsonl');
  const outputDir = path.join(process.cwd(), 'data', 'met', 'descriptions', 'gemini_2_5_flash');
  const outputFile = path.join(outputDir, 'edited_descriptions.jsonl');
  
  await ensureDirectoryExists(outputDir);
  
  // Load existing edited artwork IDs
  console.log('Loading existing edited descriptions...');
  const existingIds = await loadExistingArtworkIds(outputFile);
  console.log(`Found ${existingIds.size} existing edited descriptions`);
  
  // Open output file in append mode
  const writer = createWriteStream(outputFile, { flags: 'a' });
  
  // Process descriptions
  console.log('\nProcessing descriptions...');
  console.log(`Limit: ${options.limit || 'none'}`);
  console.log(`Batch size: ${options.batchSize}`);
  if (options.artworkIds) {
    console.log(`Specific artwork IDs: ${options.artworkIds.join(', ')}`);
  }
  
  const fileStream = createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalEdited = 0;
  let totalUnchanged = 0;
  let totalFailed = 0;
  let batchCount = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    // Check if we've hit the limit
    if (options.limit && totalProcessed >= options.limit) {
      console.log(`\nReached limit of ${options.limit} descriptions`);
      break;
    }
    
    try {
      const record: DescriptionRecord = JSON.parse(line);
      
      // Skip if already edited
      if (existingIds.has(record.artwork_id)) {
        totalSkipped++;
        continue;
      }
      
      // Skip if specific IDs requested and this isn't one
      if (options.artworkIds && !options.artworkIds.includes(record.artwork_id)) {
        continue;
      }
      
      console.log(`\n[${totalProcessed + 1}] Processing ${record.artwork_id}: ${record.metadata.title}`);
      
      const result = await processDescription(record, writer);
      
      if (result.success) {
        totalProcessed++;
        if (result.edited) {
          totalEdited++;
          batchCount++;
          
          // Rate limiting
          if (batchCount >= options.batchSize) {
            console.log(`\n--- Completed batch of ${options.batchSize}, waiting 1s for rate limiting ---`);
            await sleep(1000);
            batchCount = 0;
          }
        } else {
          totalUnchanged++;
        }
      } else {
        totalFailed++;
        console.log(`  ✗ Failed: ${result.reason}`);
      }
      
    } catch (error) {
      console.error('Error parsing line:', error);
    }
  }
  
  // Close the writer
  writer.end();
  
  console.log('\n\nSUMMARY');
  console.log('=======');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total skipped (already exists): ${totalSkipped}`);
  console.log(`Total edited: ${totalEdited}`);
  console.log(`Total unchanged: ${totalUnchanged}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log(`\nEdited descriptions saved to: ${outputFile}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}