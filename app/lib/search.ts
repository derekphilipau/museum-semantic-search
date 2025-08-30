'use client';

import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { SearchResponse, SearchMode } from '@/app/types';

const ES_URL = process.env.NEXT_PUBLIC_ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'met_artworks_v2';

// Get text embedding from our API
async function getTextEmbedding(text: string, model: ModelKey): Promise<number[] | null> {
  try {
    const response = await fetch('/api/embeddings/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model }),
    });

    if (!response.ok) {
      console.error('Text embedding request failed:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error('Error getting text embedding:', error);
    return null;
  }
}

interface SearchParams {
  query?: string;
  model?: ModelKey;
  mode?: SearchMode;
  size?: number;
  from?: number;
}

// Build Elasticsearch query based on search mode
async function buildSearchQuery(params: SearchParams) {
  const { query, mode = 'keyword', model = 'voyage_multimodal_3' } = params;

  // Keyword search
  if (mode === 'keyword') {
    return {
      bool: {
        must: query ? [{
          multi_match: {
            query,
            fields: ['metadata.title^3', 'metadata.artist^2', 'metadata.department', 'metadata.culture', 'metadata.tags'],
            type: 'best_fields',
            fuzziness: 'AUTO'
          }
        }] : []
      }
    };
  }

  // Semantic search
  if (mode === 'semantic') {
    if (!query) {
      return { match_all: {} };
    }

    const embedding = await getTextEmbedding(query, model);
    if (!embedding) {
      throw new Error('Failed to generate text embedding');
    }

    const fieldName = model;

    return {
      knn: {
        field: `embeddings.${fieldName}`,
        query_vector: embedding,
        k: 10,
        num_candidates: 20
      }
    };
  }

  // Hybrid search
  if (mode === 'hybrid') {
    if (!query) {
      return { match_all: {} };
    }

    const embedding = await getTextEmbedding(query, model);
    if (!embedding) {
      throw new Error('Failed to generate text embedding');
    }

    const fieldName = model;

    return {
      knn: {
        field: `embeddings.${fieldName}`,
        query_vector: embedding,
        k: 10,
        num_candidates: 20
      },
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: ['metadata.title^3', 'metadata.artist^2', 'metadata.department', 'metadata.culture', 'metadata.tags'],
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          }]
        }
      }
    };
  }

  return { match_all: {} };
}

// Define proper types for Elasticsearch query
interface ElasticsearchQuery {
  bool?: {
    must?: Array<{
      multi_match: {
        query: string;
        fields: string[];
        type: string;
        fuzziness: string;
      };
    }>;
  };
  match_all?: {};
  knn?: {
    field: string;
    query_vector: number[];
    k: number;
    num_candidates: number;
  };
  query?: ElasticsearchQuery;
}

interface ElasticsearchSearchBody {
  size: number;
  from: number;
  _source: string[];
  query?: ElasticsearchQuery;
  knn?: {
    field: string;
    query_vector: number[];
    k: number;
    num_candidates: number;
  };
}

// Direct Elasticsearch search
export async function searchArtworks(params: SearchParams): Promise<SearchResponse> {
  const { size = 20, from = 0 } = params;

  try {
    const queryConfig = await buildSearchQuery(params);

    // Build the search request body
    const searchBody: ElasticsearchSearchBody = {
      size,
      from,
      _source: ['id', 'metadata', 'embeddings', 'image', 'searchableText']
    };

    // Handle different query structures based on search mode
    if ('knn' in queryConfig) {
      searchBody.knn = queryConfig.knn;
      if (queryConfig.query) {
        searchBody.query = queryConfig.query;
      }
    } else {
      searchBody.query = queryConfig;
    }

    const response = await fetch(`${ES_URL}/${INDEX_NAME}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      throw new Error(`ES search failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      took: data.took,
      total: data.hits.total.value,
      hits: data.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}