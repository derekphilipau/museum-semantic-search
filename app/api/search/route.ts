import { NextRequest, NextResponse } from 'next/server';
import {
  EMBEDDING_MODELS,
  ModelKey,
  embedJinaText,
  embedJinaClipText,
} from '@/lib/embeddings';
import {
  performKeywordSearch,
  performSemanticSearchWithEmbedding,
  performHybridSearchWithEmbeddings,
  performEmojiSearch,
  getIndexStats,
} from '@/lib/elasticsearch/client';
import { SearchResponse, ESSearchQuery, ESHybridQuery } from '@/app/types';
import { HybridMode } from '@/app/components/SearchForm';
import {
  getCachedEmbeddings,
  setCachedEmbeddings,
} from '@/lib/embeddings/cache';

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
    emoji?: boolean;
  };
  size?: number;
}

interface UnifiedSearchResponse {
  keyword: SearchResponse | null;
  semantic: Record<string, SearchResponse>;
  hybrid: { model: string; results: SearchResponse; mode?: HybridMode } | null;
  metadata?: {
    cache: {
      hit: boolean;
      key?: string;
    };
  };
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
    const modelSelections = options.models ?? {};
    const selectedModels = (Object.keys(EMBEDDING_MODELS) as ModelKey[]).filter(
      (modelKey) => modelSelections[modelKey]
    );

    // Pre-fetch embeddings if ANY semantic search is needed
    let embeddings: Partial<Record<ModelKey, number[]>> = {};
    let cacheHit = false;
    
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
      // Check cache first
      const cached = await getCachedEmbeddings(query);

      if (cached) {
        embeddings = cached;
        cacheHit = true;
      } else {
        // Generate new embeddings if not cached
        try {
          const computed: Partial<Record<ModelKey, number[]>> = {};

          const needTextEmbedding = selectedModels.includes('jina_text');
          const needImageEmbedding = selectedModels.includes(
            'jina_clip'
          );

          if (needTextEmbedding || options.hybrid) {
            const vector = await embedJinaText(query);
            computed.jina_text = vector.values;
          }

          if (needImageEmbedding || options.hybrid) {
            const vector = await embedJinaClipText(query);
            computed.jina_clip = vector.values;
          }

          embeddings = computed;

          if (Object.keys(computed).length > 0) {
            await setCachedEmbeddings(query, computed);
          }
        } catch (error) {
          console.error('Failed to generate embeddings:', error);
          // Continue with empty embeddings - searches will fail gracefully
        }
      }
    }

    // Build search promises based on selected options
    const searchPromises: Promise<{ type: string; model?: string; results: SearchResponse }>[] = [];

    // Keyword search - check if it's an emoji-only query
    if (options.keyword) {
      // Check if query contains only emojis
      const queryEmojis = query.match(/\p{Emoji}/gu) || [];
      const queryWithoutEmojis = query.replace(/\p{Emoji}/gu, '').trim();
      const isEmojiOnlyQuery = queryEmojis.length > 0 && queryWithoutEmojis === '' && options.emoji;
      
      if (isEmojiOnlyQuery) {
        // For emoji-only queries, use emoji search but return as keyword
        searchPromises.push(
          performEmojiSearch(queryEmojis, size)
            .then(results => ({ type: 'keyword', results }))
            .catch(error => {
              console.error('Emoji search failed:', error);
              return { type: 'keyword', results: { took: 0, total: 0, hits: [] } };
            })
        );
      } else {
        // Regular keyword search
        searchPromises.push(
          performKeywordSearch(query, size, options.includeDescriptions)
            .then(results => ({ type: 'keyword', results }))
            .catch(error => {
              console.error('Keyword search failed:', error);
              return { type: 'keyword', results: { took: 0, total: 0, hits: [] } };
            })
        );
      }
    }

    // Semantic searches using pre-computed embeddings
    for (const model of selectedModels) {
      const embedding = embeddings[model];
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
        // Prefer text-only embeddings
        modelsToUse = selectedModels.find((m) => m === 'jina_text');
        if (!modelsToUse) {
          modelsToUse = selectedModels.find(
            (m) => EMBEDDING_MODELS[m]?.supportsText
          );
        }
      } else if (hybridMode === 'image') {
        // Prefer image-capable embeddings
        modelsToUse = selectedModels.find((m) => m === 'jina_clip');
        if (!modelsToUse) {
          modelsToUse = selectedModels.find(
            (m) => EMBEDDING_MODELS[m]?.supportsImage
          );
        }
      } else if (hybridMode === 'both') {
        // Combine text + image-capable embeddings when available
        const models: ModelKey[] = [];
        const textModel = selectedModels.find((m) => m === 'jina_text');
        const clipModel = selectedModels.find(
          (m) => m === 'jina_clip'
        );

        if (textModel) models.push(textModel);
        if (clipModel) models.push(clipModel);

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
        esQueries,
        cache: {
          hit: cacheHit,
          // Only include cache info if embeddings were needed
          ...(selectedModels.length > 0 || options.hybrid ? {
            query: query,
            embeddingsUsed: cacheHit ? 'cached' : 'generated'
          } : {})
        }
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
