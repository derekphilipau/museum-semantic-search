import { Suspense } from 'react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { generateUnifiedEmbeddings, extractSigLIP2Embedding, extractJinaV3Embedding } from '@/lib/embeddings';
import { 
  performKeywordSearch, 
  performSemanticSearchWithEmbedding, 
  performHybridSearchWithEmbeddings,
  performEmojiSearch,
  getIndexStats 
} from '@/lib/elasticsearch/client';
import { SearchResponse, ESSearchQuery, ESHybridQuery } from '@/app/types';
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
  const includeDescriptions = params.includeDescriptions !== 'false';
  const emoji = params.emoji === 'true';
  
  // Parse models - if not specified, all models are enabled
  const modelsParam = params.models as string;
  const enabledModels = modelsParam ? modelsParam.split(',') : Object.keys(EMBEDDING_MODELS);
  
  const models = Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({
    ...acc,
    [key]: enabledModels.includes(key)
  }), {} as Record<string, boolean>);

  return { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions, emoji };
}


// Server component that performs search
async function SearchResults({ searchParams }: PageProps) {
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions, emoji } = await parseSearchParams(searchParams);
  
  if (!query) {
    return null;
  }

  // Pre-fetch unified embeddings if any semantic search is needed
  const selectedModels = Object.entries(models)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as ModelKey);
  
  let embeddings: { siglip2?: number[]; jina_v3?: number[] } = {};
  
  if (selectedModels.length > 0 || hybrid) {
    try {
      const unified = await generateUnifiedEmbeddings(query);
      embeddings = {
        siglip2: extractSigLIP2Embedding(unified).embedding,
        jina_v3: extractJinaV3Embedding(unified).embedding
      };
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
    }
  }

  // Build search promises
  const searchPromises: Promise<{ type: string; model?: string; results: SearchResponse }>[] = [];

  // If emoji search is enabled and query contains emojis, prioritize emoji search
  const queryEmojis = query.match(/\p{Emoji}/gu) || [];
  const isEmojiSearch = emoji && queryEmojis.length > 0;

  // Keyword search - use emoji search if it's an emoji-only query
  if (keyword) {
    if (isEmojiSearch) {
      // For emoji queries, use emoji search but return as keyword results
      searchPromises.push(
        performEmojiSearch(queryEmojis, 20)
          .then(results => ({ type: 'keyword', results }))
          .catch(error => {
            console.error('Emoji search failed:', error);
            return { type: 'keyword', results: { took: 0, total: 0, hits: [] } };
          })
      );
    } else {
      // Regular keyword search
      searchPromises.push(
        performKeywordSearch(query, 20, includeDescriptions)
          .then(results => ({ type: 'keyword', results }))
      );
    }
  }

  // Semantic searches using pre-computed embeddings
  for (const model of selectedModels) {
    const embedding = embeddings[model as keyof typeof embeddings];
    if (embedding) {
      searchPromises.push(
        performSemanticSearchWithEmbedding(embedding, model, 20)
          .then(results => ({ type: 'semantic', model, results }))
      );
    }
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
        performHybridSearchWithEmbeddings(query, embeddings, modelsToUse, 20, includeDescriptions, hybridBalance)
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
        keyword: undefined as ESSearchQuery | undefined,
        semantic: {} as Record<string, ESSearchQuery>,
        hybrid: undefined as ESHybridQuery | undefined
      }
    }
  };

  // Process results
  for (const result of searchResults) {
    if (result.type === 'keyword') {
      results.keyword = result.results;
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.keyword = (result.results as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
      }
    } else if (result.type === 'semantic' && result.model) {
      results.semantic[result.model] = result.results;
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.semantic[result.model] = (result.results as SearchResponse & { esQuery?: ESSearchQuery }).esQuery!;
      }
    } else if (result.type === 'hybrid' && result.model) {
      results.hybrid = {
        model: result.model,
        results: result.results,
        mode: hybridMode
      };
      // Extract ES query if available
      if ('esQuery' in result.results && results.metadata.esQueries) {
        results.metadata.esQueries.hybrid = (result.results as SearchResponse & { esQuery?: ESHybridQuery }).esQuery;
      }
    }
  }
  
  // Clean up esQuery properties from response objects
  if (results.keyword && 'esQuery' in results.keyword) {
    delete (results.keyword as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
  }
  for (const model in results.semantic) {
    if ('esQuery' in results.semantic[model]) {
      delete (results.semantic[model] as SearchResponse & { esQuery?: ESSearchQuery }).esQuery;
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
  const { query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions, emoji } = await parseSearchParams(searchParams);
  const resolvedParams = await searchParams;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-6">
        <SearchForm 
          key={JSON.stringify({ query, keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions, emoji })} // Reset form when any URL param changes
          initialQuery={query}
          initialOptions={{ keyword, models, hybrid, hybridMode, hybridBalance, includeDescriptions, emoji }}
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