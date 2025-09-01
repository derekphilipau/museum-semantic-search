export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  processingTime: number;
}

// SigLIP 2 configuration
export const SIGLIP_CONFIG = {
  name: 'SigLIP 2',
  description: 'Google SigLIP 2 - improved multilingual vision-language model with better localization',
  dimensions: 768, // base model
  provider: 'huggingface',
  modelId: 'google/siglip2-base-patch16-224',
  inputTypes: ['text', 'image'],
  maxInputTokens: 64, // SigLIP 2 uses shorter sequences than CLIP
};

// Alternative models available:
// SigLIP 2 (newest, recommended):
// - google/siglip2-base-patch16-224 (768 dims) - recommended
// - google/siglip2-base-patch16-256 (768 dims)
// - google/siglip2-base-patch16-384 (768 dims)
// - google/siglip2-large-patch16-256 (1024 dims)
// - google/siglip2-large-patch16-384 (1024 dims)

// Original SigLIP 2:
// - google/siglip-base-patch16-224 (768 dims)
// - google/siglip-base-patch16-256 (768 dims)
// - google/siglip-so400m-patch14-384 (1152 dims)

interface SigLIP2Response {
  // HF returns embeddings directly as array
  [key: string]: any;
}

export async function generateSigLIPEmbedding(
  input: string | Buffer,
  inputType: 'text' | 'image' = 'text'
): Promise<EmbeddingResult> {
  // For text embeddings, use Modal API or fallback to local server
  if (inputType === 'text') {
    const modalUrl = process.env.MODAL_EMBEDDING_URL;
    const localServerUrl = process.env.SIGLIP2_SERVER_URL || 'http://localhost:5000';
    const startTime = Date.now();
    
    // Try Modal API first if configured
    if (modalUrl) {
      try {
        const response = await fetch(modalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            text: input,
            model: 'siglip2'
          }),
        });

        if (response.ok) {
          const result = await response.json();
          
          // Check for error in response
          if (result.error) {
            console.error('Modal API error:', result.error);
          } else if (result.embedding) {
            return {
              embedding: result.embedding,
              model: 'siglip2',
              dimensions: result.dimension || result.embedding.length,
              processingTime: result.processing_time ? result.processing_time * 1000 : Date.now() - startTime
            };
          }
        }
      } catch (error) {
        console.warn('Modal API not available, falling back to local server:', error);
      }
    }
    
    // Fallback to local server
    try {
      const response = await fetch(`${localServerUrl}/embed/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: input }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // If server is not running, return a placeholder embedding
        if (response.status === 0 || response.statusText === 'Failed to fetch') {
          console.warn('SigLIP 2 server not available, returning placeholder embedding');
          return {
            embedding: new Array(768).fill(0),
            model: 'siglip2',
            dimensions: 768,
            processingTime: Date.now() - startTime
          };
        }
        
        throw new Error(`SigLIP 2 server error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      return {
        embedding: result.embedding,
        model: 'siglip2',
        dimensions: result.dimension,
        processingTime: Date.now() - startTime
      };
      
    } catch (error: any) {
      // If server is not available, return placeholder
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        console.warn('No SigLIP 2 service available, returning placeholder embedding');
        return {
          embedding: new Array(768).fill(0),
          model: 'siglip2',
          dimensions: 768,
          processingTime: Date.now() - startTime
        };
      }
      throw error;
    }
  }
  
  // For images, this would need a different implementation
  // For now, throw an error
  throw new Error('Image embedding generation not implemented for SigLIP 2');
}

// Helper to check if model is loaded (for cold starts)
export async function warmupSigLIP2Model(): Promise<boolean> {
  const token = process.env.HUGGINGFACE_API_TOKEN;
  if (!token) return false;

  try {
    // Send a small test request to warm up the model
    await generateSigLIPEmbedding('test', 'text');
    return true;
  } catch (error: any) {
    if (error.message.includes('Model is loading')) {
      console.log('SigLIP 2 model is loading, please wait...');
      return false;
    }
    throw error;
  }
}

// Batch processing with rate limit handling
export async function generateSigLIP2EmbeddingsBatch(
  items: Array<{ id: string; input: string | Buffer; type: 'text' | 'image' }>,
  options: {
    batchSize?: number;
    delayMs?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Map<string, EmbeddingResult>> {
  const { 
    batchSize = 10, 
    delayMs = 1000, // 1 second between batches for rate limiting
    onProgress 
  } = options;
  
  const results = new Map<string, EmbeddingResult>();
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (item) => {
      try {
        const result = await generateSigLIPEmbedding(item.input, item.type);
        return { id: item.id, result };
      } catch (error) {
        console.error(`Failed to generate embedding for ${item.id}:`, error);
        return { id: item.id, result: null };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Store results
    for (const { id, result } of batchResults) {
      if (result) {
        results.set(id, result);
      }
    }
    
    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + batchSize, items.length), items.length);
    }
    
    // Rate limit delay (except for last batch)
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}