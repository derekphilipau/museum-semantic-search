import { Suspense } from 'react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { generateEmbedding } from '@/lib/embeddings';
import { 
  performKeywordSearch, 
  performSemanticSearch, 
  performHybridSearch,
  getIndexStats 
} from '@/lib/elasticsearch/client';
import { SearchResponse } from '@/app/types';
import SearchForm, { HybridMode } from './components/SearchForm';
import SearchResultsWrapper from './components/SearchResultsWrapper';
import { Skeleton } from '@/components/ui/skeleton';

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

// Parse search params with defaults
function parseSearchParams(searchParams: PageProps['searchParams']) {
  const query = (searchParams.q as string) || '';
  const keyword = searchParams.keyword !== 'false';
  const hybrid = searchParams.hybrid !== 'false';
  const hybridMode = (searchParams.hybridMode as HybridMode) || 'image';
  const hybridBalance = searchParams.hybridBalance ? parseFloat(searchParams.hybridBalance as string) : 0.5;
  const includeDescriptions = searchParams.includeDescriptions === 'true';
  
  // Parse models - if not specified, all models are enabled
  const modelsParam = searchParams.models as string;
  const enabledModels = modelsParam ? modelsParam.split(',') : Object.keys(EMBEDDING_MODELS);
  
  const models = Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({
    ...acc,
    [key]: enabledModels.includes(key)
  }), {} as Record<string, boolean>);

  return { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions };
}


// Server component that performs search
async function SearchResults({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions } = parseSearchParams(searchParams);
  
  if (!query) {
    return null;
  }

  // Pre-generate embeddings in parallel for all models
  const selectedModels = Object.entries(models)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key as ModelKey);
  
  if (selectedModels.length > 0) {
    await Promise.all(
      selectedModels.map(model => generateEmbedding(query, model))
    );
  }

  // Build search promises
  const searchPromises: Promise<{ type: string; model?: string; results: SearchResponse }>[] = [];

  // Keyword search
  if (keyword) {
    searchPromises.push(
      performKeywordSearch(query, 10, includeDescriptions)
        .then(results => ({ type: 'keyword', results }))
    );
  }

  // Semantic searches
  for (const model of selectedModels) {
    searchPromises.push(
      performSemanticSearch(query, model)
        .then(results => ({ type: 'semantic', model, results }))
    );
  }

  // For hybrid search, we'll run separate searches and combine with normalization
  // We don't add hybrid to searchPromises as we'll handle it separately after all searches complete

  // Track query start time
  const queryStartTime = Date.now();

  // Execute all searches in parallel and get index stats
  const [searchResults, indexStats] = await Promise.all([
    Promise.all(searchPromises),
    getIndexStats()
  ]);

  // Calculate total query time
  const totalQueryTime = Date.now() - queryStartTime;

  // Organize results
  const results = {
    keyword: null as SearchResponse | null,
    semantic: {} as Record<string, SearchResponse>,
    hybrid: null as { model: string; results: SearchResponse; mode?: HybridMode } | null,
    metadata: {
      ...(indexStats || {}),
      timestamp: new Date().toISOString(),
      totalQueryTime
    }
  };

  // Process results
  for (const result of searchResults) {
    if (result.type === 'keyword') {
      results.keyword = result.results;
    } else if (result.type === 'semantic' && result.model) {
      results.semantic[result.model] = result.results;
    }
  }

  // Handle hybrid search with score normalization
  if (hybrid && selectedModels.length > 0) {
    // Determine which semantic model to use based on hybrid mode
    let semanticResults: SearchResponse | null = null;
    let hybridModel: string = '';
    
    if (hybridMode === 'text') {
      const textModel = selectedModels.find(m => m === 'google_gemini_text');
      if (textModel && results.semantic[textModel]) {
        semanticResults = results.semantic[textModel];
        hybridModel = textModel;
      }
    } else if (hybridMode === 'image') {
      const imageModel = selectedModels.find(m => m === 'google_vertex_multimodal');
      if (imageModel && results.semantic[imageModel]) {
        semanticResults = results.semantic[imageModel];
        hybridModel = imageModel;
      }
    } else if (hybridMode === 'both') {
      // For "both" mode, merge text and image semantic results first
      const textModel = selectedModels.find(m => m === 'google_gemini_text');
      const imageModel = selectedModels.find(m => m === 'google_vertex_multimodal');
      const textResults = textModel ? results.semantic[textModel] : null;
      const imageResults = imageModel ? results.semantic[imageModel] : null;
      
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
    if (results.keyword && semanticResults) {
      // Score normalization function
      const normalizeScores = (hits: any[], minScore: number, maxScore: number) => {
        if (maxScore === minScore) return hits.map(h => ({ ...h, normalizedScore: 1 }));
        return hits.map(hit => ({
          ...hit,
          normalizedScore: (hit._score - minScore) / (maxScore - minScore)
        }));
      };
      
      // Get min/max scores for normalization
      const keywordScores = results.keyword.hits.map(h => h._score);
      const semanticScores = semanticResults.hits.map(h => h._score);
      
      const keywordMin = Math.min(...keywordScores);
      const keywordMax = Math.max(...keywordScores);
      const semanticMin = Math.min(...semanticScores);
      const semanticMax = Math.max(...semanticScores);
      
      // Normalize scores
      const normalizedKeyword = normalizeScores(results.keyword.hits, keywordMin, keywordMax);
      const normalizedSemantic = normalizeScores(semanticResults.hits, semanticMin, semanticMax);
      
      // Combine with balance parameter (0 = all keyword, 1 = all semantic)
      const balance = hybridBalance;
      const keywordWeight = 1 - balance;
      const semanticWeight = balance;
      
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
        .slice(0, 10);
      
      results.hybrid = {
        model: hybridModel,
        results: {
          took: Math.max(results.keyword.took, semanticResults.took),
          total: mergedHits.size,
          hits: hybridHits
        },
        mode: hybridMode
      };
    }
  }

  return (
    <SearchResultsWrapper
      query={query}
      results={results}
    />
  );
}

export default function Home({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions } = parseSearchParams(searchParams);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-6">
        <SearchForm 
          initialQuery={query}
          initialOptions={{ keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions }}
        />
        
        <Suspense 
          key={JSON.stringify(searchParams)} 
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Loading skeleton for search result columns */}
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="bg-gradient-to-r from-gray-200 to-gray-300 rounded-t-lg p-4">
                    <Skeleton className="h-5 w-32 mx-auto mb-2" />
                    <Skeleton className="h-3 w-48 mx-auto" />
                  </div>
                  <div className="p-3 space-y-2">
                    {[...Array(3)].map((_, j) => (
                      <Skeleton key={j} className="h-20 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <SearchResults searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}