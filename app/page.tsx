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
import SearchForm from './components/SearchForm';
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
  const includeDescriptions = searchParams.includeDescriptions === 'true';
  
  // Parse models - if not specified, all models are enabled
  const modelsParam = searchParams.models as string;
  const enabledModels = modelsParam ? modelsParam.split(',') : Object.keys(EMBEDDING_MODELS);
  
  const models = Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({
    ...acc,
    [key]: enabledModels.includes(key)
  }), {} as Record<string, boolean>);

  return { query, keyword, models, hybrid, includeDescriptions };
}


// Server component that performs search
async function SearchResults({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, includeDescriptions } = parseSearchParams(searchParams);
  
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

  // Hybrid search
  if (hybrid && selectedModels.length > 0) {
    const hybridModel = selectedModels.includes('jina_embeddings_v4' as ModelKey)
      ? 'jina_embeddings_v4' as ModelKey
      : selectedModels[0];
    
    searchPromises.push(
      performHybridSearch(query, hybridModel, 10, includeDescriptions)
        .then(results => ({ type: 'hybrid', model: hybridModel, results }))
    );
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
    hybrid: null as { model: string; results: SearchResponse } | null,
    metadata: {
      ...(indexStats || {}),
      timestamp: new Date().toISOString(),
      totalQueryTime
    }
  };

  for (const result of searchResults) {
    if (result.type === 'keyword') {
      results.keyword = result.results;
    } else if (result.type === 'semantic' && result.model) {
      results.semantic[result.model] = result.results;
    } else if (result.type === 'hybrid' && result.model) {
      results.hybrid = {
        model: result.model,
        results: result.results
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
  const { query, keyword, models, hybrid, includeDescriptions } = parseSearchParams(searchParams);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-6">
        <SearchForm 
          initialQuery={query}
          initialOptions={{ keyword, models, hybrid, includeDescriptions }}
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