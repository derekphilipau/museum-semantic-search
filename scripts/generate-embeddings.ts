#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';

// Load environment variables from .env.local
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

import { esClient, INDEX_NAME } from './lib/elasticsearch';
import { generateImageEmbedding as generateImageEmbeddingAPI } from '../lib/embeddings/image';
import { EMBEDDING_MODELS, ModelKey } from '../lib/embeddings/types';

interface Stats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

interface RateLimiter {
  lastRequest: number;
  minInterval: number;
}

// Rate limiters for different APIs
const rateLimiters: Record<string, RateLimiter> = {
  // Currently no rate limiters needed for Jina or Google
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function respectRateLimit(model: ModelKey): Promise<void> {
  const limiter = rateLimiters[model];
  if (!limiter) return;
  
  const now = Date.now();
  const timeSinceLastRequest = now - limiter.lastRequest;
  
  if (timeSinceLastRequest < limiter.minInterval) {
    const waitTime = limiter.minInterval - timeSinceLastRequest;
    console.log(`Rate limiting for ${model}: waiting ${Math.ceil(waitTime / 1000)}s`);
    await sleep(waitTime);
  }
  
  limiter.lastRequest = Date.now();
}

async function imageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (error) {
    console.error(`Error fetching image ${imageUrl}:`, error);
    throw error;
  }
}

async function generateImageEmbedding(
  imageUrl: string,
  model: ModelKey,
  interleaveText?: string
): Promise<number[] | null> {
  try {
    // Respect rate limits
    await respectRateLimit(model);
    
    // For API-based models, we need to handle image data differently
    const modelConfig = EMBEDDING_MODELS[model];
    
    if (modelConfig.supportsImage) {
      console.log(`Generating ${model} embedding for image URL`);
      
      // Download image to temp file for the API
      const tempDir = path.join(process.cwd(), 'tmp');
      await fs.mkdir(tempDir, { recursive: true });
      const tempFile = path.join(tempDir, `temp_${Date.now()}.jpg`);
      
      try {
        // Download image
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(tempFile, Buffer.from(buffer));
        
        // Use the actual image embedding API
        const result = await generateImageEmbeddingAPI(tempFile, model, interleaveText);
        
        // Clean up temp file
        await fs.unlink(tempFile);
        
        return result.embedding;
      } catch (error) {
        // Clean up on error
        try {
          await fs.unlink(tempFile);
        } catch {}
        throw error;
      }
    }
    
    console.warn(`Model ${model} does not support image embeddings`);
    return null;
  } catch (error) {
    console.error(`Error generating embedding for ${imageUrl} with ${model}:`, error);
    return null;
  }
}

async function updateDocumentEmbeddings(
  docId: string,
  embeddings: Record<string, number[]>
): Promise<void> {
  try {
    await esClient.update({
      index: INDEX_NAME,
      id: docId,
      body: {
        doc: {
          embeddings,
        },
      },
    });
  } catch (error) {
    console.error(`Error updating document ${docId}:`, error);
    throw error;
  }
}

async function processArtwork(
  doc: any,
  models: ModelKey[],
  skipExisting: boolean,
  stats: Record<ModelKey, Stats>
): Promise<void> {
  const { _id: docId, _source: artwork } = doc;
  
  if (!artwork.image) {
    console.log(`Skipping ${docId}: no image`);
    return;
  }
  
  // Get image URL from the artwork
  const imageUrl = typeof artwork.image === 'string' ? artwork.image : artwork.image.url;
  
  if (!imageUrl) {
    console.log(`No image URL found for ${docId}`);
    models.forEach(model => stats[model].failed++);
    return;
  }
  
  const updatedEmbeddings: Record<string, number[]> = { ...artwork.embeddings };
  let hasUpdates = false;
  
  for (const model of models) {
    const modelStats = stats[model];
    
    const fieldName = model;
    
    // Check if embedding already exists
    if (skipExisting && updatedEmbeddings[fieldName]?.length > 0) {
      console.log(`Skipping ${model} for ${artwork.metadata.title} - already exists`);
      modelStats.skipped++;
      continue;
    }
    
    // Generate embedding with interleaved text for models that support it
    const modelConfig = EMBEDDING_MODELS[model];
    const interleaveText = modelConfig.supportsInterleaved && artwork.searchableText
      ? artwork.searchableText
      : undefined;
    
    if (interleaveText && model === 'jina_embeddings_v4') {
      console.log(`  Using text+image for Jina v4: "${interleaveText.substring(0, 100)}..."`);
    }
    
    const embedding = await generateImageEmbedding(imageUrl, model, interleaveText);
    
    if (embedding) {
      updatedEmbeddings[fieldName] = embedding;
      hasUpdates = true;
      modelStats.success++;
      console.log(`✓ Generated ${model} embedding for: ${artwork.metadata.title}`);
    } else {
      modelStats.failed++;
      console.log(`✗ Failed ${model} embedding for: ${artwork.metadata.title}`);
    }
  }
  
  // Update document if we have new embeddings
  if (hasUpdates) {
    await updateDocumentEmbeddings(docId, updatedEmbeddings);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modelsArg = args.find(arg => arg.startsWith('--models='));
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const noSkipExisting = args.includes('--no-skip-existing');
  
  const models = modelsArg 
    ? modelsArg.split('=')[1].split(',') as ModelKey[]
    : ['jina_embeddings_v4', 'google_vertex_multimodal'] as ModelKey[];
  
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const skipExisting = !noSkipExisting;
  
  // Validate models
  const validModels = models.filter(m => EMBEDDING_MODELS[m]);
  if (validModels.length !== models.length) {
    const invalid = models.filter(m => !EMBEDDING_MODELS[m]);
    console.error(`Invalid models: ${invalid.join(', ')}`);
    console.log('Available models:', Object.keys(EMBEDDING_MODELS).join(', '));
    process.exit(1);
  }
  
  console.log('Artwork Embedding Generation Script');
  console.log('===================================');
  console.log(`Models: ${validModels.join(', ')}`);
  console.log(`Skip existing: ${skipExisting}`);
  console.log(`Limit: ${limit || 'none'}`);
  console.log('');
  
  // Initialize stats
  const stats: Record<ModelKey, Stats> = {} as Record<ModelKey, Stats>;
  validModels.forEach(model => {
    stats[model] = { total: 0, success: 0, failed: 0, skipped: 0 };
  });
  
  try {
    // Get all documents
    const searchResponse = await esClient.search({
      index: INDEX_NAME,
      size: limit || 10000,
      _source: ['metadata.title', 'image', 'embeddings', 'searchableText'],
      query: {
        match_all: {}
      }
    });
    
    const documents = searchResponse.hits.hits;
    console.log(`Found ${documents.length} documents with images`);
    
    // Update total count
    validModels.forEach(model => {
      stats[model].total = documents.length;
    });
    
    // Process each document
    for (let i = 0; i < documents.length; i++) {
      console.log(`\n[${i + 1}/${documents.length}] Processing artwork...`);
      await processArtwork(documents[i], validModels, skipExisting, stats);
    }
    
    // Print summary
    console.log('\n\nSummary');
    console.log('=======');
    
    validModels.forEach(model => {
      const s = stats[model];
      console.log(`\n${model}:`);
      console.log(`  Total: ${s.total}`);
      console.log(`  Success: ${s.success}`);
      console.log(`  Failed: ${s.failed}`);
      console.log(`  Skipped: ${s.skipped}`);
    });
    
    console.log('\nEmbedding generation complete!');
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { generateImageEmbedding, updateDocumentEmbeddings };