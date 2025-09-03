export interface EmbeddingModel {
  key: string;
  name: string;
  dimension: number;
  supportsImage: boolean;
  supportsInterleaved: boolean;
  url: string;
  description: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  dimension: number;
}

export interface EmbeddingError {
  error: string;
  details?: string;
}

export interface UnifiedEmbeddingResponse {
  text: string | null;
  embeddings: {
    jina_v3?: {
      embedding: number[];
      dimension: number;
      processing_time: number;
    };
    siglip2?: {
      embedding: number[];
      dimension: number;
      processing_time: number;
    };
  };
  total_processing_time: number;
  device: string;
  input_type: string;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  jina_v3: {
    key: 'jina_v3',
    name: 'Text Embeddings',
    dimension: 768,
    supportsImage: false,
    supportsInterleaved: false,
    url: 'https://jina.ai/embeddings/',
    description: 'Jina v3 (metadata + AI descriptions)',
  },
  siglip2: {
    key: 'siglip2',
    name: 'Image Embeddings',
    dimension: 768,
    supportsImage: true,
    supportsInterleaved: false,
    url: 'https://huggingface.co/google/siglip2-base-patch16-224',
    description: 'SigLIP 2 Text-to-image search',
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;