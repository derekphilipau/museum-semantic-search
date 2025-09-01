import { EMBEDDING_MODELS, ModelKey, EmbeddingResponse } from './types';
import { generateSigLIPEmbedding } from './siglip2';
import { generateJinaV3Embedding } from './jina';

export async function generateEmbedding(
  text: string,
  modelKey: ModelKey
): Promise<EmbeddingResponse> {
  const model = EMBEDDING_MODELS[modelKey];
  if (!model) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  switch (modelKey) {
    case 'siglip2':
      const result = await generateSigLIPEmbedding(text, 'text');
      return {
        embedding: result.embedding,
        model: result.model,
        dimension: result.dimensions
      };
    
    case 'jina_v3':
      const jinaResult = await generateJinaV3Embedding(text);
      return {
        embedding: jinaResult.embedding,
        model: jinaResult.model,
        dimension: jinaResult.dimensions
      };
    
    default:
      throw new Error(`Model ${modelKey} not implemented`);
  }
}

export { EMBEDDING_MODELS, type ModelKey, type EmbeddingResponse } from './types';