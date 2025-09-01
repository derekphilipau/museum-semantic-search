import { UnifiedEmbeddingResponse } from './types';

const modalUrl = process.env.MODAL_EMBEDDING_URL || process.env.NEXT_PUBLIC_MODAL_EMBEDDING_URL;

if (!modalUrl) {
  console.warn('Modal embedding URL not configured');
}

/**
 * Generate embeddings for an image using Modal API
 * @param imageBase64 Base64-encoded image data
 * @returns Unified embedding response with SigLIP2 embedding
 */
export async function generateImageEmbedding(
  imageBase64: string
): Promise<UnifiedEmbeddingResponse> {
  if (!modalUrl) {
    throw new Error('Modal embedding URL not configured');
  }

  try {
    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    // Map the response to our UnifiedEmbeddingResponse format
    return {
      text: null, // No text for image input
      embeddings: result.embeddings,
      total_processing_time: result.total_processing_time,
      device: result.device,
      input_type: result.input_type
    };
  } catch (error) {
    console.error('Error generating image embedding:', error);
    throw error;
  }
}

/**
 * Extract SigLIP2 embedding from image embedding response
 * @param response Unified embedding response
 * @returns SigLIP2 embedding data
 */
export function extractImageSigLIP2Embedding(response: UnifiedEmbeddingResponse): {
  embedding: number[];
  dimension: number;
  processing_time: number;
} {
  const siglip2 = response.embeddings.siglip2;
  
  if (!siglip2 || !siglip2.embedding) {
    throw new Error('No SigLIP2 embedding found in response');
  }
  
  return {
    embedding: siglip2.embedding,
    dimension: siglip2.dimension,
    processing_time: siglip2.processing_time
  };
}