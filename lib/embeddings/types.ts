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
  jina_clip_v2: {
    key: 'jina_clip_v2',
    name: 'JinaCLIP v2',
    dimension: 1024,
    year: '2024',
    notes: '🎨 Best for visual art - 98% accuracy on Flickr30k',
    supportsImage: true,
    supportsInterleaved: false,
  },
  jina_embeddings_v4: {
    key: 'jina_embeddings_v4',
    name: 'Jina Embeddings v4',
    dimension: 2048,
    year: '2025',
    notes: '🚀 Multimodal with text+image fusion',
    supportsImage: true,
    supportsInterleaved: true,
  },
  google_vertex_multimodal: {
    key: 'google_vertex_multimodal',
    name: 'Google Vertex Multimodal',
    dimension: 1408,
    year: '2024',
    notes: '🆓 Free tier 1500 RPM!',
    supportsImage: true,
    supportsInterleaved: false,
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;