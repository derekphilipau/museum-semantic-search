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
  siglip2: {
    key: 'siglip2',
    name: 'SigLIP 2 Cross-Modal',
    dimension: 768,
    year: '2025',
    notes: 'True text-to-image search v2',
    supportsImage: true,
    supportsInterleaved: false,
  },
  jina_v3: {
    key: 'jina_v3',
    name: 'Jina v3 Text',
    dimension: 768,
    year: '2024',
    notes: 'Advanced text embeddings with metadata + descriptions',
    supportsImage: false,
    supportsInterleaved: false,
  },
};

export type ModelKey = keyof typeof EMBEDDING_MODELS;