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
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Parse search params with defaults
async function parseSearchParams(searchParams: PageProps['searchParams']) {
  const params = await searchParams;
  const query = (params.q as string) || '';
  const keyword = params.keyword !== 'false';
  const hybrid = params.hybrid !== 'false';
  const hybridMode = (params.hybridMode as HybridMode) || 'image';
  const hybridBalance = params.hybridBalance ? parseFloat(params.hybridBalance as string) : 0.5;
  const includeDescriptions = params.includeDescriptions === 'true';
  
  // Parse models - if not specified, all models are enabled
  const modelsParam = params.models as string;
  const enabledModels = modelsParam ? modelsParam.split(',') : Object.keys(EMBEDDING_MODELS);
  
  const models = Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({
    ...acc,
    [key]: enabledModels.includes(key)
  }), {} as Record<string, boolean>);

  return { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions };
}


// Server component that performs search
async function SearchResults({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions } = await parseSearchParams(searchParams);
  
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

  // Semantic searches - always show individual semantic results
  for (const model of selectedModels) {
    searchPromises.push(
      performSemanticSearch(query, model)
        .then(results => ({ type: 'semantic', model, results }))
    );
  }

  // Hybrid search - use Elasticsearch's native hybrid search with RRF
  if (hybrid && selectedModels.length > 0) {
    let modelsToUse: ModelKey | ModelKey[] | undefined;
    
    if (hybridMode === 'both') {
      // For "both" mode, use both Jina v3 (text) and SigLIP 2 (image)
      const models: ModelKey[] = [];
      const jinaModel = selectedModels.find(m => m === 'jina_v3');
      const siglipModel = selectedModels.find(m => m === 'siglip2');
      
      if (jinaModel) models.push(jinaModel);
      if (siglipModel) models.push(siglipModel);
      
      if (models.length > 0) {
        modelsToUse = models;
      }
    } else {
      // Single model hybrid search
      if (hybridMode === 'text') {
        // Use Jina v3 for text mode hybrid search
        modelsToUse = selectedModels.find(m => m === 'jina_v3');
      } else if (hybridMode === 'image') {
        // Use SigLIP 2 for image mode hybrid search (cross-modal)
        modelsToUse = selectedModels.find(m => m === 'siglip2');
      }
    }
    
    if (modelsToUse) {
      searchPromises.push(
        performHybridSearch(query, modelsToUse, 10, includeDescriptions, hybridBalance)
          .then(results => ({ 
            type: 'hybrid', 
            model: Array.isArray(modelsToUse) ? 'multi' : modelsToUse, 
            results 
          }))
      );
    }
  }

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
      totalQueryTime,
      esQueries: {
        keyword: undefined as any,
        semantic: {} as Record<string, any>,
        hybrid: undefined as any
      }
    }
  };

  // Process results
  for (const result of searchResults) {
    if (result.type === 'keyword') {
      results.keyword = result.results;
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.keyword = (result.results as any).esQuery;
      }
    } else if (result.type === 'semantic' && result.model) {
      results.semantic[result.model] = result.results;
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.semantic[result.model] = (result.results as any).esQuery;
      }
    } else if (result.type === 'hybrid' && result.model) {
      results.hybrid = {
        model: result.model,
        results: result.results,
        mode: hybridMode
      };
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.hybrid = (result.results as any).esQuery;
      }
    }
  }
  
  // Clean up esQuery properties from response objects
  if (results.keyword && 'esQuery' in results.keyword) {
    delete (results.keyword as any).esQuery;
  }
  for (const model in results.semantic) {
    if ('esQuery' in results.semantic[model]) {
      delete (results.semantic[model] as any).esQuery;
    }
  }
  
  return (
    <SearchResultsWrapper
      query={query}
      results={results}
    />
  );
}

export default async function Home({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions } = await parseSearchParams(searchParams);
  const resolvedParams = await searchParams;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-6">
        <SearchForm 
          initialQuery={query}
          initialOptions={{ keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions }}
        />
        
        <Suspense 
          key={JSON.stringify(resolvedParams)} 
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