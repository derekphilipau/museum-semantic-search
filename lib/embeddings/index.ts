import { EMBEDDING_MODELS, ModelKey, EmbeddingResponse } from './types';
import { generateGoogleEmbedding, generateGoogleTextEmbedding } from './google';

export async function generateEmbedding(
  text: string,
  modelKey: ModelKey
): Promise<EmbeddingResponse> {
  const model = EMBEDDING_MODELS[modelKey];
  if (!model) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  switch (modelKey) {
    case 'google_gemini_text':
      return generateGoogleTextEmbedding(text, 'text-embedding-005');
    
    case 'google_vertex_multimodal':
      return generateGoogleEmbedding(text, 'multimodalembedding@001');
    
    default:
      throw new Error(`Model ${modelKey} not implemented`);
  }
}

export { EMBEDDING_MODELS, type ModelKey, type EmbeddingResponse } from './types';