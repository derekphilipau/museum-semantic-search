import { EMBEDDING_MODELS, ModelKey, EmbeddingResponse } from './types';
import { generateJinaEmbedding } from './jina';
import { generateVoyageEmbedding } from './voyage';
import { generateCohereEmbedding } from './cohere';
import { generateGoogleEmbedding } from './google';

export async function generateEmbedding(
  text: string,
  modelKey: ModelKey
): Promise<EmbeddingResponse> {
  const model = EMBEDDING_MODELS[modelKey];
  if (!model) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  switch (modelKey) {
    case 'jina_clip_v2':
      return generateJinaEmbedding(text, 'jina-clip-v2');
    
    case 'voyage_multimodal_3':
      return generateVoyageEmbedding(text, 'voyage-multimodal-3');
    
    case 'cohere_embed_4':
      return generateCohereEmbedding(text, 'embed-multilingual-v3.0');
    
    case 'google_vertex_multimodal':
      return generateGoogleEmbedding(text, 'multimodalembedding@001');
    
    default:
      throw new Error(`Model ${modelKey} not implemented`);
  }
}

export { EMBEDDING_MODELS, type ModelKey, type EmbeddingResponse } from './types';