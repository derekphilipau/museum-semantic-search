import { ModelKey } from './types';
import * as fs from 'fs/promises';

// Image embedding functions - currently unused
// SigLIP 2 handles image embeddings through its own pipeline

// Main function to generate image embeddings
export async function generateImageEmbedding(
  imagePath: string,
  model: ModelKey,
  interleaveText?: string
): Promise<{ embedding: number[]; model: string; dimension: number }> {
  // Currently no image embedding models are configured
  // SigLIP is handled separately through its own pipeline
  throw new Error(`Unsupported model for image embeddings: ${model}`);
}