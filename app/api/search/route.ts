import { NextRequest, NextResponse } from 'next/server';
import { ModelKey, EMBEDDING_MODELS, generateUnifiedEmbeddings } from '@/lib/embeddings';
import { extractSigLIP2Embedding, extractJinaV3Embedding } from '@/lib/embeddings/unified';
import { 
  performKeywordSearch, 
  performSemanticSearchWithEmbedding,
  performHybridSearchWithEmbeddings,
  getIndexStats
} from '@/lib/elasticsearch/client';
import { SearchResponse, ESSearchQuery, ESHybridQuery } from '@/app/types';
import { HybridMode } from '@/app/components/SearchForm';

// Type definitions
interface SearchRequest {
  query: string;
  options: {
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
    hybridMode?: HybridMode;
    hybridBalance?: number;
    includeDescriptions?: boolean;
  };
  size?: number;
}

interface UnifiedSearchResponse {
  keyword: SearchResponse | null;
  semantic: Record<string, SearchResponse>;
  hybrid: { model: string; results: SearchResponse; mode?: HybridMode } | null;
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
    const { query, options, size = 20 } = body;
    const hybridBalance = options.hybridBalance ?? 0.5;

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

    // Get selected models
    const selectedModels = Object.keys(EMBEDDING_MODELS).filter(
      modelKey => options.models[modelKey]
    ) as ModelKey[];

    // Pre-fetch embeddings if ANY semantic search is needed
    let embeddings: { siglip2?: number[]; jina_v3?: number[] } = {};
    
    // Initialize ES queries for metadata
    const esQueries: {
      keyword?: ESSearchQuery;
      semantic: Record<string, ESSearchQuery>;
      hybrid?: ESHybridQuery;
    } = {
      keyword: undefined,
      semantic: {},
      hybrid: undefined
    };
    
    if (selectedModels.length > 0 || options.hybrid) {
      // Always fetch both embeddings in one call if we need any embeddings
      try {
        const unified = await generateUnifiedEmbeddings(query);
        embeddings = {
          siglip2: extractSigLIP2Embedding(unified).embedding,
          jina_v3: extractJinaV3Embedding(unified).embedding
        };
      } catch (error) {
        console.error('Failed to generate embeddings:', error);
        // Continue with empty embeddings - searches will fail gracefully
      }
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

    // Semantic searches using pre-computed embeddings
    for (const model of selectedModels) {
      const embedding = embeddings[model as keyof typeof embeddings];
      if (embedding) {
        searchPromises.push(
          performSemanticSearchWithEmbedding(embedding, model, size)
            .then(results => ({ type: 'semantic', model, results }))
            .catch(error => {
              console.error(`Semantic search failed for ${model}:`, error);
              return { type: 'semantic', model, results: { took: 0, total: 0, hits: [] } };
            })
        );
      } else {
        // No embedding available for this model
        searchPromises.push(
          Promise.resolve({ type: 'semantic', model, results: { took: 0, total: 0, hits: [] } })
        );
      }
    }

    // For hybrid search, we'll run separate searches and combine with normalization
    // We don't add hybrid to searchPromises as we'll handle it separately after all searches complete

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

    // Process results
    for (const result of searchResults) {
      if (result.type === 'keyword') {
        response.keyword = result.results;
      } else if (result.type === 'semantic' && result.model) {
        response.semantic[result.model] = result.results;
      }
    }

    // Handle hybrid search using native Elasticsearch RRF
    if (options.hybrid && selectedModels.length > 0) {
      const hybridMode = options.hybridMode || 'image';
      let modelsToUse: ModelKey | ModelKey[] | undefined;
      
      if (hybridMode === 'text') {
        // Use Jina v3 for text mode hybrid search
        modelsToUse = selectedModels.find(m => m === 'jina_v3');
        if (!modelsToUse) {
          console.warn('Jina v3 not found in selectedModels, using first text model');
          modelsToUse = selectedModels.find(m => 
            EMBEDDING_MODELS[m] && !EMBEDDING_MODELS[m].supportsImage
          );
        }
      } else if (hybridMode === 'image') {
        // Use SigLIP 2 for image mode hybrid search (cross-modal)
        modelsToUse = selectedModels.find(m => m === 'siglip2');
        if (!modelsToUse) {
          console.warn('SigLIP not found in selectedModels, using first image model');
          modelsToUse = selectedModels.find(m => 
            EMBEDDING_MODELS[m] && EMBEDDING_MODELS[m].supportsImage
          );
        }
      } else if (hybridMode === 'both') {
        // For "both" mode, use both Jina v3 (text) and SigLIP 2 (image)
        const models: ModelKey[] = [];
        const jinaModel = selectedModels.find(m => m === 'jina_v3');
        const siglipModel = selectedModels.find(m => m === 'siglip2');
        
        if (jinaModel) models.push(jinaModel);
        if (siglipModel) models.push(siglipModel);
        
        if (models.length > 0) {
          modelsToUse = models;
        }
      }
      
      // Run hybrid search with pre-computed embeddings
      if (modelsToUse) {
        try {
          const hybridResults = await performHybridSearchWithEmbeddings(
            query,
            embeddings,
            modelsToUse, 
            size, 
            options.includeDescriptions,
            hybridBalance
          );
          
          response.hybrid = {
            model: Array.isArray(modelsToUse) ? 'combined' : modelsToUse,
            results: hybridResults,
            mode: hybridMode
          };
          
          // Extract ES query info
          if ('esQuery' in hybridResults) {
            esQueries.hybrid = (hybridResults as SearchResponse & { esQuery?: ESHybridQuery }).esQuery;
            delete (hybridResults as SearchResponse & { esQuery?: ESHybridQuery }).esQuery;
          }
        } catch (error) {
          console.error('Hybrid search error:', error);
        }
      }
    }
    
    // Extract ES queries from responses
    if (response.keyword && 'esQuery' in response.keyword) {
      esQueries.keyword = (response.keyword as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
      delete (response.keyword as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
    }
    
    for (const model in response.semantic) {
      if ('esQuery' in response.semantic[model]) {
        esQueries.semantic[model] = (response.semantic[model] as SearchResponse & { esQuery?: ESSearchQuery }).esQuery!;
        delete (response.semantic[model] as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
      }
    }
    
    
    // Add metadata to response
    const responseWithMetadata = {
      ...response,
      metadata: {
        ...(indexStats || {}),
        timestamp: new Date().toISOString(),
        esQueries
      }
    };

    return NextResponse.json(responseWithMetadata, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error('Search API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Search failed';
    const statusCode = error instanceof Error && 'statusCode' in error ? 
      (error as Error & { statusCode?: number }).statusCode || 500 : 500;
    
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