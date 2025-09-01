// Only export the unified embeddings function and types
export { EMBEDDING_MODELS, type ModelKey, type EmbeddingResponse } from './types';
export { generateUnifiedEmbeddings, extractSigLIP2Embedding, extractJinaV3Embedding } from './unified';