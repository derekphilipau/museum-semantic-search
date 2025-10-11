export {
  EMBEDDING_MODELS,
  type ModelKey,
  type EmbeddingModel,
  type EmbeddingVector,
  type EmbeddingBatchResult,
  type EmbedTextOptions,
  type GeminiTaskType,
} from './types';

export {
  embedJinaText,
  embedJinaTextBatch,
  embedJinaClipImage,
  embedJinaClipText,
} from './jina';
