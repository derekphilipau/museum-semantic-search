export type ModelKey = 'jina_text' | 'jina_clip';

export interface EmbeddingModel {
  key: ModelKey;
  name: string;
  description: string;
  dimension: number;
  defaultTask?: GeminiTaskType;
  supportsImage: boolean;
  supportsText: boolean;
  recommendedUse: 'query' | 'document' | 'hybrid';
  url?: string;
}

export type GeminiTaskType =
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING'
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'CODE_RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION';

export interface EmbeddingVector {
  model: ModelKey;
  values: number[];
  dimension: number;
  taskType?: GeminiTaskType;
  normalized?: boolean;
}

export interface EmbeddingBatchResult {
  model: ModelKey;
  vectors: EmbeddingVector[];
}

export interface EmbedTextOptions {
  taskType?: GeminiTaskType;
  outputDimensionality?: number;
  normalize?: boolean;
}

const DEFAULT_JINA_TEXT_DIMENSION =
  Number.parseInt(process.env.JINA_TEXT_EMBED_DIM ?? '1024', 10) || 1024;

const DEFAULT_JINA_CLIP_DIMENSION =
  Number.parseInt(process.env.JINA_CLIP_EMBED_DIM ?? '1024', 10) || 1024;

export const EMBEDDING_MODELS: Record<ModelKey, EmbeddingModel> = {
  jina_text: {
    key: 'jina_text',
    name: 'Jina v3 Text Embeddings',
    description:
      'jina-embeddings-v3 text embeddings optimised for retrieval and semantic similarity.',
    dimension: DEFAULT_JINA_TEXT_DIMENSION,
    supportsImage: false,
    supportsText: true,
    recommendedUse: 'hybrid',
    url: 'https://jina.ai/embeddings/',
  },
  jina_clip: {
    key: 'jina_clip',
    name: 'Jina CLIP v2 Image Embeddings',
    description:
      'jina-clip-v2 image embeddings for cross-modal visual similarity.',
    dimension: DEFAULT_JINA_CLIP_DIMENSION,
    defaultTask: 'RETRIEVAL_DOCUMENT',
    supportsImage: true,
    supportsText: false,
    recommendedUse: 'hybrid',
    url: 'https://jina.ai/embeddings/',
  },
};
