import { NextRequest, NextResponse } from 'next/server';
import { ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings';
import { 
  performKeywordSearch, 
  performSemanticSearch, 
  performHybridSearch,
  getIndexStats,
  INDEX_NAME 
} from '@/lib/elasticsearch/client';
import { SearchResponse, SearchMode } from '@/app/types';

// Type definitions
interface SearchRequest {
  query: string;
  options: {
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
    includeDescriptions?: boolean;
  };
  size?: number;
}

interface UnifiedSearchResponse {
  keyword: SearchResponse | null;
  semantic: Record<string, SearchResponse>;
  hybrid: { model: string; results: SearchResponse } | null;
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
        performKeywordSearch(query, size, options.includeDescriptions)
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
        performSemanticSearch(query, model, size)
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
        performHybridSearch(query, hybridModel, size, options.includeDescriptions)
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

    // Get index stats (lightweight operation)
    const indexStats = await getIndexStats();

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

    // Add metadata to response
    const responseWithMetadata = {
      ...response,
      metadata: {
        ...(indexStats || {}),
        timestamp: new Date().toISOString()
      }
    };

    return NextResponse.json(responseWithMetadata, {
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