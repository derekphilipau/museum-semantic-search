/**
 * Unified embeddings client that fetches both SigLIP 2 and Jina v3 embeddings
 * in a single Modal API call for efficient search operations
 */

interface UnifiedEmbeddingResponse {
  text: string;
  embeddings: {
    siglip2: {
      embedding: number[];
      dimension: number;
      processing_time: number;
    };
    jina_v3: {
      embedding: number[];
      dimension: number;
      processing_time: number;
    };
  };
  total_processing_time: number;
  device: string;
}

export async function generateUnifiedEmbeddings(
  text: string
): Promise<UnifiedEmbeddingResponse> {
  const modalUrl = process.env.MODAL_EMBEDDING_API_URL || process.env.MODAL_EMBEDDING_URL;
  
  if (!modalUrl) {
    throw new Error('MODAL_EMBEDDING_API_URL not configured');
  }
  
  try {
    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Modal API error: ${response.status} ${error}`);
    }

    const result: UnifiedEmbeddingResponse = await response.json();
    
    if (!result.embeddings?.siglip2?.embedding || !result.embeddings?.jina_v3?.embedding) {
      throw new Error('Invalid response from Modal API');
    }
    
    return result;
  } catch (error) {
    console.error('Unified embeddings error:', error);
    throw error;
  }
}

// Helper to extract individual embeddings
export function extractSigLIP2Embedding(response: UnifiedEmbeddingResponse) {
  return {
    embedding: response.embeddings.siglip2.embedding,
    model: 'siglip2',
    dimensions: response.embeddings.siglip2.dimension,
  };
}

export function extractJinaV3Embedding(response: UnifiedEmbeddingResponse) {
  return {
    embedding: response.embeddings.jina_v3.embedding,
    model: 'jina_v3',
    dimensions: response.embeddings.jina_v3.dimension,
  };
}