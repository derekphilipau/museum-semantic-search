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
  voyage_multimodal_3: {
    key: 'voyage_multimodal_3',
    name: 'Voyage Multimodal-3',
    dimension: 1024,
    year: '2025',
    notes: '🚀 Supports interleaved image+text embeddings',
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
  cohere_embed_4: {
    key: 'cohere_embed_4',
    name: 'Cohere Embed 4',
    dimension: 1024,
    year: '2025',
    notes: '📄 128K context - optimized for documents',
    supportsImage: true,
    supportsInterleaved: true,
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;