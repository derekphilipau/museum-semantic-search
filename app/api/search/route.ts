import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@elastic/elasticsearch';
import { generateEmbedding, ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings';
import { SearchResponse, SearchMode } from '@/app/types';

// Initialize Elasticsearch client
const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

// Type definitions
interface SearchRequest {
  query: string;
  options: {
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
  };
  size?: number;
}

interface UnifiedSearchResponse {
  keyword: SearchResponse | null;
  semantic: Record<string, SearchResponse>;
  hybrid: { model: string; results: SearchResponse } | null;
}

// Build Elasticsearch query based on search mode
async function buildSearchQuery(query: string, mode: SearchMode, model?: ModelKey) {
  // Keyword search
  if (mode === 'keyword') {
    return {
      bool: {
        must: query ? [{
          multi_match: {
            query,
            fields: [
              'metadata.title^3',
              'metadata.artist^2',
              'metadata.classification^1.5',
              'metadata.medium',
              'metadata.date',
              'metadata.artistNationality',
              'metadata.department'
            ],
            type: 'best_fields',
            fuzziness: 'AUTO'
          }
        }] : []
      }
    };
  }

  // Semantic search
  if (mode === 'semantic' && model) {
    if (!query) {
      return { match_all: {} };
    }

    const embeddingResult = await generateEmbedding(query, model);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate text embedding');
    }

    const fieldName = model;

    return {
      knn: {
        field: `embeddings.${fieldName}`,
        query_vector: embeddingResult.embedding,
        k: 10,
        num_candidates: 20
      }
    };
  }

  // Hybrid search
  if (mode === 'hybrid' && model) {
    if (!query) {
      return { match_all: {} };
    }

    const embeddingResult = await generateEmbedding(query, model);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate text embedding');
    }

    const fieldName = model;

    return {
      knn: {
        field: `embeddings.${fieldName}`,
        query_vector: embeddingResult.embedding,
        k: 10,
        num_candidates: 20
      },
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: [
                'metadata.title^3',
                'metadata.artist^2',
                'metadata.classification^1.5',
                'metadata.medium',
                'metadata.date',
                'metadata.artistNationality',
                'metadata.department'
              ],
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

// Perform Elasticsearch search
async function performSearch(query: string, mode: SearchMode, model?: ModelKey, size: number = 10): Promise<SearchResponse> {
  try {
    const queryConfig = await buildSearchQuery(query, mode, model);

    // Build the search request body
    const searchBody: any = {
      size,
      _source: ['id', 'metadata', 'image', 'searchableText']  // Exclude embeddings to reduce response size
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

    const response = await client.search({
      index: INDEX_NAME,
      body: searchBody
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error(`Search error for ${mode} mode:`, error);
    throw error;
  }
}

// Get allowed origins from environment or use defaults
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim());
  return envOrigins?.length ? envOrigins : ['http://localhost:3000'];
}

// Helper to get CORS headers
function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: SearchRequest = await request.json();
    const { query, options, size = 10 } = body;

    // Validate request
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query parameter is required and must be a string' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    if (!options || typeof options !== 'object') {
      return NextResponse.json(
        { error: 'Options parameter is required' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // Build search promises based on selected options
    const searchPromises: Promise<{ type: string; model?: string; results: SearchResponse }>[] = [];

    // Keyword search
    if (options.keyword) {
      searchPromises.push(
        performSearch(query, 'keyword', undefined, size)
          .then(results => ({ type: 'keyword', results }))
          .catch(error => {
            console.error('Keyword search failed:', error);
            return { type: 'keyword', results: { took: 0, total: 0, hits: [] } };
          })
      );
    }

    // Semantic searches for selected models
    const selectedModels = Object.keys(EMBEDDING_MODELS).filter(
      modelKey => options.models[modelKey]
    ) as ModelKey[];

    for (const model of selectedModels) {
      searchPromises.push(
        performSearch(query, 'semantic', model, size)
          .then(results => ({ type: 'semantic', model, results }))
          .catch(error => {
            console.error(`Semantic search failed for ${model}:`, error);
            return { type: 'semantic', model, results: { took: 0, total: 0, hits: [] } };
          })
      );
    }

    // Hybrid search - prioritize Jina v4 if available, otherwise use first selected model
    if (options.hybrid && selectedModels.length > 0) {
      const hybridModel = selectedModels.includes('jina_embeddings_v4' as ModelKey)
        ? 'jina_embeddings_v4' as ModelKey
        : selectedModels[0];
      
      searchPromises.push(
        performSearch(query, 'hybrid', hybridModel, size)
          .then(results => ({ type: 'hybrid', model: hybridModel, results }))
          .catch(error => {
            console.error(`Hybrid search failed for ${hybridModel}:`, error);
            return { type: 'hybrid', model: hybridModel, results: { took: 0, total: 0, hits: [] } };
          })
      );
    }

    // Execute all searches in parallel for better performance
    // This runs keyword, all semantic searches, and hybrid search concurrently
    const searchResults = await Promise.all(searchPromises);

    // Organize results
    const response: UnifiedSearchResponse = {
      keyword: null,
      semantic: {},
      hybrid: null,
    };

    for (const result of searchResults) {
      if (result.type === 'keyword') {
        response.keyword = result.results;
      } else if (result.type === 'semantic' && result.model) {
        response.semantic[result.model] = result.results;
      } else if (result.type === 'hybrid' && result.model) {
        response.hybrid = {
          model: result.model,
          results: result.results
        };
      }
    }

    return NextResponse.json(response, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error('Search API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Search failed';
    const statusCode = error instanceof Error && 'statusCode' in error ? 
      (error as any).statusCode : 500;
    
    return NextResponse.json(
      { error: errorMessage },
      { 
        status: statusCode,
        headers: getCorsHeaders(request),
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}