import { EMBEDDING_MODELS, ModelKey, EmbeddingResponse } from './types';
import { generateJinaEmbedding } from './jina';
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
    case 'jina_embeddings_v3':
      return generateJinaEmbedding(text, 'jina-embeddings-v3');
    
    case 'jina_embeddings_v4':
      return generateJinaEmbedding(text, 'jina-embeddings-v4');
    
    case 'google_vertex_multimodal':
      return generateGoogleEmbedding(text, 'multimodalembedding@001');
    
    default:
      throw new Error(`Model ${modelKey} not implemented`);
  }
}

export { EMBEDDING_MODELS, type ModelKey, type EmbeddingResponse } from './types';