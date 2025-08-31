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
  jina_embeddings_v3: {
    key: 'jina_embeddings_v3',
    name: 'Jina v3 (Text-only)',
    dimension: 1024,
    year: '2024',
    notes: 'jina-embeddings-v3',
    supportsImage: false,
    supportsInterleaved: false,
  },
  jina_embeddings_v4: {
    key: 'jina_embeddings_v4',
    name: 'Jina v4 (Visual)',
    dimension: 2048,
    year: '2025',
    notes: 'jina-embeddings-v4',
    supportsImage: true,
    supportsInterleaved: false, // Changed to false - we use image-only
  },
  google_vertex_multimodal: {
    key: 'google_vertex_multimodal',
    name: 'Google Vertex (Visual)',
    dimension: 1408,
    year: '2024',
    notes: 'multimodalembedding@001',
    supportsImage: true,
    supportsInterleaved: false,
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;