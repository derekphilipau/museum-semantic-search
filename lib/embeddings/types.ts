export interface EmbeddingModel {
  key: string;
  name: string;
  dimension: number;
  year: string;
  notes: string;
  supportsImage: boolean;
  supportsInterleaved: boolean;
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

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  google_gemini_text: {
    key: 'google_gemini_text',
    name: 'Text Embeddings',
    dimension: 768,
    year: '2024',
    notes: 'text-embedding-005',
    supportsImage: false,
    supportsInterleaved: false,
  },
  google_vertex_multimodal: {
    key: 'google_vertex_multimodal',
    name: 'Image Embeddings',
    dimension: 1408,
    year: '2024',
    notes: 'multimodalembedding@001',
    supportsImage: true,
    supportsInterleaved: false,
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;