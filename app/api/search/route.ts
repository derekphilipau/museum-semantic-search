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
    const { query, options, size = 10 } = body;
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

    // Handle hybrid search with score normalization
    if (options.hybrid && selectedModels.length > 0) {
      const hybridMode = options.hybridMode || 'image';
      
      // Determine which semantic results to use
      let semanticResults: SearchResponse | null = null;
      let hybridModel: string = '';
      
      if (hybridMode === 'text') {
        const textModel = selectedModels.find(m => m === 'google_gemini_text');
        if (textModel && response.semantic[textModel]) {
          semanticResults = response.semantic[textModel];
          hybridModel = textModel;
        }
      } else if (hybridMode === 'image') {
        const imageModel = selectedModels.find(m => m === 'google_vertex_multimodal');
        if (imageModel && response.semantic[imageModel]) {
          semanticResults = response.semantic[imageModel];
          hybridModel = imageModel;
        }
      } else if (hybridMode === 'both') {
        // For "both" mode, merge text and image semantic results first
        const textModel = selectedModels.find(m => m === 'google_gemini_text');
        const imageModel = selectedModels.find(m => m === 'google_vertex_multimodal');
        const textResults = textModel ? response.semantic[textModel] : null;
        const imageResults = imageModel ? response.semantic[imageModel] : null;
        
        if (textResults || imageResults) {
          const mergedHits = new Map<string, any>();
          
          // Add all results, keeping highest scores
          [textResults, imageResults].forEach(res => {
            if (res) {
              res.hits.forEach(hit => {
                const existing = mergedHits.get(hit._id);
                if (!existing || hit._score > existing._score) {
                  mergedHits.set(hit._id, hit);
                }
              });
            }
          });
          
          semanticResults = {
            took: Math.max(textResults?.took || 0, imageResults?.took || 0),
            total: mergedHits.size,
            hits: Array.from(mergedHits.values())
          };
          hybridModel = 'combined';
        }
      }
      
      // Combine keyword and semantic results with score normalization
      if (response.keyword && semanticResults && semanticResults.hits.length > 0 && response.keyword.hits.length > 0) {
        // Score normalization function
        const normalizeScores = (hits: any[], minScore: number, maxScore: number) => {
          if (maxScore === minScore) return hits.map(h => ({ ...h, normalizedScore: 1 }));
          return hits.map(hit => ({
            ...hit,
            normalizedScore: (hit._score - minScore) / (maxScore - minScore)
          }));
        };
        
        // Get min/max scores for normalization
        const keywordScores = response.keyword.hits.map(h => h._score);
        const semanticScores = semanticResults.hits.map(h => h._score);
        
        const keywordMin = Math.min(...keywordScores);
        const keywordMax = Math.max(...keywordScores);
        const semanticMin = Math.min(...semanticScores);
        const semanticMax = Math.max(...semanticScores);
        
        // Normalize scores
        const normalizedKeyword = normalizeScores(response.keyword.hits, keywordMin, keywordMax);
        const normalizedSemantic = normalizeScores(semanticResults.hits, semanticMin, semanticMax);
        
        // Apply balance parameter (0 = all keyword, 1 = all semantic)
        const keywordWeight = 1 - hybridBalance;
        const semanticWeight = hybridBalance;
        
        // Merge results
        const mergedHits = new Map<string, any>();
        
        // Add keyword results with weighted scores
        normalizedKeyword.forEach(hit => {
          mergedHits.set(hit._id, {
            ...hit,
            _score: hit.normalizedScore * keywordWeight,
            _originalScore: hit._score,
            _scoreType: 'keyword'
          });
        });
        
        // Add/update with semantic results
        normalizedSemantic.forEach(hit => {
          const existing = mergedHits.get(hit._id);
          if (existing) {
            // Document exists in both - combine scores
            existing._score += hit.normalizedScore * semanticWeight;
            existing._scoreType = 'hybrid';
            existing._semanticScore = hit._score;
          } else {
            // Only in semantic results
            mergedHits.set(hit._id, {
              ...hit,
              _score: hit.normalizedScore * semanticWeight,
              _originalScore: hit._score,
              _scoreType: 'semantic'
            });
          }
        });
        
        // Convert to array and sort by combined score
        const hybridHits = Array.from(mergedHits.values())
          .sort((a, b) => b._score - a._score)
          .slice(0, size);
        
        response.hybrid = {
          model: hybridModel,
          results: {
            took: Math.max(response.keyword.took, semanticResults.took),
            total: mergedHits.size,
            hits: hybridHits
          },
          mode: hybridMode
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