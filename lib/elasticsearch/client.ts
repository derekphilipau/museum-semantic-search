import { Client } from '@elastic/elasticsearch';
// @ts-expect-error - TypeScript can't find the module but it exists
import type { SearchResponse as ESResponse } from '@elastic/elasticsearch/lib/api/types';
import { ModelKey } from '@/lib/embeddings';
import { SearchResponse, SearchHit, SearchResponseWithQuery, ESSearchQuery, ESHybridQuery, Artwork, SimilarArtwork } from '@/app/types';
import { SearchFilters, buildFilterClauses, hasFilters } from './filters';

// Re-export SearchFilters for convenience
export type { SearchFilters } from './filters';

// ============================================================================
// Constants
// ============================================================================

// Summary fields for artwork - essential data without full details (for 'minimal' and 'standard' detail levels)
const ARTWORK_SUMMARY_FIELDS = [
  'id',
  'title',
  'titles',
  'artist',
  'artists',
  'date',
  'dateBegin',
  'dateEnd',
  'medium',
  'dimensions',
  'classification',
  'department',
  'objectName',
  'collection',
  'collectionId',
  'creditLine',
  'accessionYear',
  'culture',
  'period',
  'dynasty',
  'country',
  'region',
  'isPublicDomain',
  'isHighlight',
  'onView',
  'galleryNumber',
  'image',
  'tags',
  'sourceUrl',
  'visual_description',
  'similar_artworks'
];

const SEARCH_CONSTANTS = {
  // Score thresholds for filtering results
  SCORE_THRESHOLDS: {
    KEYWORD: 10.0,        // Lowered to allow more keyword matches in hybrid search
    JINA_TEXT: 0.68,      // Threshold for Jina text embeddings
    JINA_CLIP: 0.6,       // Threshold for Jina CLIP embeddings
    SIMILARITY: 0.55,     // General similarity threshold
    METADATA: 2.0         // Metadata scores are typically higher
  },
  
  // RRF (Reciprocal Rank Fusion) constants
  RRF: {
    DEFAULT_K: 60,        // Default k value for RRF
    DYNAMIC_K_MIN: 20,    // Minimum k value for dynamic calculation
    DYNAMIC_K_RANGE: 40   // Range for dynamic k calculation
  },
  
  // Search size multipliers
  MULTIPLIERS: {
    RESULTS: 2,           // Fetch 2x results for fusion
    CANDIDATES: 4         // kNN num_candidates multiplier
  },
  
  // Weight calculation exponent
  WEIGHT_EXPONENT: 1.5
};

// Search fields configuration
const SEARCH_FIELDS = {
  BASE: [
    'title^3',
    'artist^2', 
    'classification^1.5',
    'tags^1.5',
    'objectName^1.2',
    'medium',
    'date',
    'artistNationality',
    'department',
    'culture',
    'country',
    'city'
  ],
  DESCRIPTIONS: [
    'visual_description.alt_text^0.8',
    'visual_description.long_description^0.5'
  ]
};

// Metadata field weights for similarity scoring
const METADATA_FIELD_WEIGHTS = {
  artist: 10,
  date: 7,
  medium: 6,
  classification: 5,
  department: 4,
  culture: 4,
  artistNationality: 4,
  period: 3,
  dynasty: 3
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Maps Elasticsearch response hits to our SearchHit format
 */
function mapESResponseToSearchHits(hits: ESResponse['hits']['hits']): SearchHit[] {
  return hits.map((hit: ESResponse['hits']['hits'][0]) => ({
    _id: hit._id,
    _score: hit._score || 0,
    _source: hit._source as Artwork
  }));
}

/**
 * Builds a standard search response object
 */
function buildSearchResponse(
  response: ESResponse, 
  hits: SearchHit[], 
  queryMetadata?: Partial<SearchResponseWithQuery>
): SearchResponseWithQuery {
  return {
    took: response.took,
    total: response.hits.total.value,
    hits,
    ...queryMetadata
  };
}

/**
 * Calculates RRF score for a given rank
 */
function calculateRRFScore(rank: number, weight: number, k: number): number {
  return weight * (1 / (k + rank + 1));
}

/**
 * Calculates dynamic k value based on balance
 */
function calculateDynamicK(balance: number): number {
  return SEARCH_CONSTANTS.RRF.DYNAMIC_K_MIN + 
    (1 - Math.abs(balance - 0.5) * 2) * SEARCH_CONSTANTS.RRF.DYNAMIC_K_RANGE;
}

/**
 * Calculates normalized weights based on balance parameter
 */
interface NormalizedWeights {
  keywordWeight: number;
  semanticWeight: number;
  normalizedKeywordWeight: number;
  normalizedSemanticWeight: number;
}

function calculateBalanceWeights(balance: number): NormalizedWeights {
  const keywordWeight = Math.pow(1 - balance, SEARCH_CONSTANTS.WEIGHT_EXPONENT);
  const semanticWeight = Math.pow(balance, SEARCH_CONSTANTS.WEIGHT_EXPONENT);
  const totalWeight = keywordWeight + semanticWeight;
  
  return {
    keywordWeight,
    semanticWeight,
    normalizedKeywordWeight: keywordWeight / totalWeight,
    normalizedSemanticWeight: semanticWeight / totalWeight
  };
}

/**
 * Gets the appropriate score threshold for a given model or search type
 */
function getScoreThreshold(model: ModelKey | 'keyword' | 'metadata' | 'similarity'): number {
  const thresholds: Record<string, number> = {
    keyword: SEARCH_CONSTANTS.SCORE_THRESHOLDS.KEYWORD,
    jina_text: SEARCH_CONSTANTS.SCORE_THRESHOLDS.JINA_TEXT,
    jina_clip: SEARCH_CONSTANTS.SCORE_THRESHOLDS.JINA_CLIP,
    similarity: SEARCH_CONSTANTS.SCORE_THRESHOLDS.SIMILARITY,
    metadata: SEARCH_CONSTANTS.SCORE_THRESHOLDS.METADATA
  };
  return thresholds[model] || 0;
}

// Singleton client instance - reuse to avoid DNS resolution storms in serverless
let cachedClient: Client | null = null;

export function getElasticsearchClient(): Client {
  // Return cached client if available
  if (cachedClient) {
    return cachedClient;
  }

  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;

  // Check if we're using Elastic Cloud
  if (cloudId && apiKey) {
    // Elastic Cloud configuration
    cachedClient = new Client({
      cloud: {
        id: cloudId
      },
      auth: {
        apiKey: apiKey
      }
    });
  } else if (apiKey && (esUrl.includes('elastic.co') || esUrl.includes('elastic-cloud.com'))) {
    // Elastic Cloud with URL (alternative setup)
    cachedClient = new Client({
      node: esUrl,
      auth: {
        apiKey: apiKey
      }
    });
  } else {
    // Local Elasticsearch (no auth required)
    cachedClient = new Client({
      node: esUrl
    });
  }

  return cachedClient;
}

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 'artworks_semantic';

// Search functions by type

export async function performKeywordSearch(
  query: string,
  size: number = 20,
  includeDescriptions: boolean = false,
  filters?: SearchFilters
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();

    const searchFields = includeDescriptions
      ? [...SEARCH_FIELDS.BASE, ...SEARCH_FIELDS.DESCRIPTIONS]
      : SEARCH_FIELDS.BASE;

    // Build filter clauses if filters are provided
    const filterClauses = hasFilters(filters) ? buildFilterClauses(filters!) : [];

    const searchBody: ESSearchQuery = {
      size,
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: searchFields,
              type: 'best_fields' as const,
              fuzziness: 'AUTO'
            }
          }],
          ...(filterClauses.length > 0 && { filter: filterClauses })
        }
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody,
      _source: ARTWORK_SUMMARY_FIELDS
    });

    return buildSearchResponse(
      response,
      mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']),
      { esQuery: searchBody }
    );
  } catch (error) {
    console.error('Keyword search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}


// Helper function to perform emoji search
export async function performEmojiSearch(
  emojis: string[],
  size: number = 20
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();
    
    // Create query based on number of emojis
    const query = emojis.length === 1
      ? {
          // Single emoji: find any artwork containing it
          term: {
            'visual_description.emoji_array': emojis[0]
          }
        }
      : {
          // Multiple emojis: find artworks containing ALL
          bool: {
            must: emojis.map(emoji => ({
              term: {
                'visual_description.emoji_array': emoji
              }
            }))
          }
        };
    
    const searchBody: ESSearchQuery = {
      size,
      query
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody,
      _source: ARTWORK_SUMMARY_FIELDS
    });

    return buildSearchResponse(
      response,
      mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']),
      { esQuery: searchBody }
    );
  } catch (error) {
    console.error('Emoji search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Helper function to perform tag search
export async function performTagSearch(
  tags: string[],
  size: number = 20,
  matchAll: boolean = true
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();
    
    // Create query based on matchAll flag
    const query = tags.length === 1
      ? {
          // Single tag: simple term query
          term: {
            'tags': tags[0]
          }
        }
      : matchAll
      ? {
          // Multiple tags: find artworks containing ALL tags
          bool: {
            must: tags.map(tag => ({
              term: {
                'tags': tag
              }
            }))
          }
        }
      : {
          // Multiple tags: find artworks containing ANY tag
          bool: {
            should: tags.map(tag => ({
              term: {
                'tags': tag
              }
            })),
            minimum_should_match: 1
          }
        };
    
    const searchBody: ESSearchQuery = {
      size,
      query
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody,
      _source: ARTWORK_SUMMARY_FIELDS
    });

    return buildSearchResponse(
      response,
      mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']),
      { esQuery: searchBody }
    );
  } catch (error) {
    console.error('Tag search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Helper function to perform semantic search with pre-computed embedding
export async function performSemanticSearchWithEmbedding(
  embedding: number[],
  model: ModelKey,
  size: number = 20,
  filters?: SearchFilters
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();

    // Build filter for kNN pre-filtering
    const filterClauses = hasFilters(filters) ? buildFilterClauses(filters!) : [];
    const knnFilter = filterClauses.length > 0
      ? { bool: { must: filterClauses } }
      : undefined;

    const searchBody: ESSearchQuery = {
      size,
      knn: {
        field: `embeddings.${model}`,
        query_vector: embedding,
        k: size,
        num_candidates: size * SEARCH_CONSTANTS.MULTIPLIERS.CANDIDATES,
        ...(knnFilter && { filter: knnFilter })
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody,
      _source: ARTWORK_SUMMARY_FIELDS
    });

    const esQuery: ESSearchQuery = {
      ...searchBody,
      knn: searchBody.knn ? {
        field: searchBody.knn.field,
        k: searchBody.knn.k,
        num_candidates: searchBody.knn.num_candidates,
        query_vector: '[embedding vector]', // Don't include full vector in UI
        ...(knnFilter && { filter: knnFilter })
      } : undefined
    };

    return buildSearchResponse(
      response,
      mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']),
      { esQuery }
    );
  } catch (error) {
    console.error(`Semantic search with embedding error for ${model}:`, error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Single embedding hybrid search with pre-computed embedding
async function performSingleEmbeddingHybridSearchWithEmbedding(
  query: string,
  embedding: number[],
  model: ModelKey,
  size: number = 20,
  includeDescriptions: boolean = false,
  balance: number = 0.5,
  filters?: SearchFilters
): Promise<SearchResponseWithQuery> {
  // If balance is 1 (100% semantic), just do a pure KNN search
  if (balance >= 0.99) {
    const result = await performSemanticSearchWithEmbedding(embedding, model, size, filters);
    // Convert ESSearchQuery to ESHybridQuery if esQuery exists
    if ('esQuery' in result && result.esQuery) {
      const hybridQuery: ESHybridQuery = {
        ...result.esQuery,
        note: 'Pure semantic search (100% balance)',
        balance,
        model,
        k: 60,
        weights: {
          keyword: { raw: 0, normalized: 0 },
          semantic: { raw: 1, normalized: 1 }
        }
      };
      return { ...result, esQuery: hybridQuery };
    }
    return result as SearchResponse & { esQuery?: ESHybridQuery };
  }

  // If balance is 0 (100% keyword), just do keyword search
  if (balance <= 0.01) {
    const result = await performKeywordSearch(query, size, includeDescriptions, filters);
    // Convert ESSearchQuery to ESHybridQuery if esQuery exists
    if ('esQuery' in result && result.esQuery) {
      const hybridQuery: ESHybridQuery = {
        ...result.esQuery,
        note: 'Pure keyword search (0% balance)',
        balance,
        model,
        k: 60,
        weights: {
          keyword: { raw: 1, normalized: 1 },
          semantic: { raw: 0, normalized: 0 }
        }
      };
      return { ...result, esQuery: hybridQuery };
    }
    return result as SearchResponse & { esQuery?: ESHybridQuery };
  }

  // For balanced search, use manual RRF like the multi-embedding version
  // Run parallel searches: keyword + semantic
  const searchPromises: Promise<SearchResponse & { esQuery?: ESSearchQuery | ESHybridQuery }>[] = [];

  // Keyword search
  const searchSize = size * SEARCH_CONSTANTS.MULTIPLIERS.RESULTS;
  searchPromises.push(performKeywordSearch(query, searchSize, includeDescriptions, filters));

  // Semantic search
  searchPromises.push(performSemanticSearchWithEmbedding(embedding, model, searchSize, filters));
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results[1];
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: SearchHit, rrfScore: number, keywordRank?: number, semanticRank?: number }>();
  
  // Calculate dynamic k value based on balance
  const k = calculateDynamicK(balance);
  
  // Calculate normalized weights based on balance
  const weights = calculateBalanceWeights(balance);

  // Debug logging
  console.log(`Hybrid search debug - Model: ${model}, Balance: ${balance}, K: ${k}`);
  console.log(`Weights - Keyword: ${weights.normalizedKeywordWeight}, Semantic: ${weights.normalizedSemanticWeight}`);
  console.log(`Keyword results: ${keywordResults.hits.length}, Semantic results: ${semanticResults.hits.length}`);

  // Process keyword results with score filtering
  const keywordThreshold = getScoreThreshold('keyword');
  const keywordFiltered = keywordResults.hits.filter(hit => hit._score >= keywordThreshold);
  console.log(`Keyword filtered: ${keywordFiltered.length} (threshold: ${keywordThreshold})`);
  
  keywordFiltered.forEach((hit, rank) => {
    const rrfScore = calculateRRFScore(rank, weights.normalizedKeywordWeight, k);
    documentScores.set(hit._id, { hit, rrfScore, keywordRank: rank });
  });
  
  // Process semantic results with score filtering
  // For hybrid search, use a more lenient threshold to ensure results aren't completely filtered out
  const semanticThreshold = balance > 0.8 ? getScoreThreshold(model) : getScoreThreshold(model) * 0.7;
  const semanticFiltered = semanticResults.hits.filter(hit => hit._score >= semanticThreshold);
  console.log(`Semantic filtered: ${semanticFiltered.length} (threshold: ${semanticThreshold}, model: ${model})`);
  
  semanticFiltered.forEach((hit, rank) => {
      const rrfScore = calculateRRFScore(rank, weights.normalizedSemanticWeight, k);
      
      if (documentScores.has(hit._id)) {
        const existing = documentScores.get(hit._id)!;
        existing.rrfScore += rrfScore;
        existing.semanticRank = rank;
      } else {
        documentScores.set(hit._id, { hit, rrfScore, semanticRank: rank });
      }
    });
  
  // Sort by RRF score and take top N
  const sortedHits = Array.from(documentScores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, size)
    .map(({ hit, rrfScore }) => ({
      ...hit,
      _score: rrfScore
    }));
  
  console.log(`Final hybrid results: ${sortedHits.length} documents (from ${documentScores.size} unique)`);
  
  return {
    took: Math.max(keywordResults.took || 0, semanticResults.took || 0),
    total: documentScores.size,
    hits: sortedHits,
    esQuery: {
      note: 'Single-model hybrid search with manual RRF',
      balance,
      k,
      weights: {
        keyword: {
          raw: weights.keywordWeight,
          normalized: weights.normalizedKeywordWeight
        },
        semantic: {
          raw: weights.semanticWeight,
          normalized: weights.normalizedSemanticWeight
        }
      },
      model,
      keywordQuery: keywordResults.esQuery as ESSearchQuery | undefined,
      semanticQuery: semanticResults.esQuery as ESSearchQuery | undefined
    }
  };
}

// Multiple embedding hybrid search with pre-computed embeddings
async function performMultipleEmbeddingHybridSearchWithEmbeddings(
  query: string,
  embeddings: Partial<Record<ModelKey, number[]>>,
  models: ModelKey[],
  size: number = 20,
  includeDescriptions: boolean = false,
  balance: number = 0.5,
  filters?: SearchFilters
): Promise<SearchResponseWithQuery> {
  // Run parallel searches: one keyword + one knn per model
  const searchPromises: Promise<SearchResponse & { esQuery?: ESSearchQuery | ESHybridQuery }>[] = [];

  // Keyword search
  const searchSize = size * SEARCH_CONSTANTS.MULTIPLIERS.RESULTS;
  searchPromises.push(performKeywordSearch(query, searchSize, includeDescriptions, filters));

  // Semantic searches using pre-computed embeddings
  for (const model of models) {
    const vector = embeddings[model];
    if (vector) {
      searchPromises.push(
        performSemanticSearchWithEmbedding(vector, model, searchSize, filters)
      );
    }
  }
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results.slice(1);
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: SearchHit, rrfScore: number }>();
  
  // Calculate dynamic k value based on balance
  const k = calculateDynamicK(balance);
  
  // Calculate normalized weights based on balance
  const weights = calculateBalanceWeights(balance);

  // Debug logging for multi-model hybrid
  console.log(`Multi-model hybrid search - Models: ${models.join(', ')}, Balance: ${balance}, K: ${k}`);
  console.log(`Weights - Keyword: ${weights.normalizedKeywordWeight}, Semantic: ${weights.normalizedSemanticWeight}`);
  console.log(`Keyword results: ${keywordResults.hits.length}, Semantic results: ${semanticResults.map(r => r.hits.length).join(', ')}`);

  // Process keyword results with score filtering
  const keywordThreshold = getScoreThreshold('keyword');
  const keywordFiltered = keywordResults.hits.filter(hit => hit._score >= keywordThreshold);
  console.log(`Keyword filtered: ${keywordFiltered.length} (threshold: ${keywordThreshold})`);
  
  keywordFiltered.forEach((hit, rank) => {
    const rrfScore = calculateRRFScore(rank, weights.normalizedKeywordWeight, k);
    documentScores.set(hit._id, { hit, rrfScore });
  });
  
  // Process semantic results with score filtering
  // For hybrid search, use a more lenient threshold to ensure results aren't completely filtered out
  semanticResults.forEach((result, index) => {
    const model = models[index];
    const semanticThreshold = balance > 0.8 ? getScoreThreshold(model) : getScoreThreshold(model) * 0.7;
    const semanticFiltered = result.hits.filter(hit => hit._score >= semanticThreshold);
    console.log(`Semantic ${model} filtered: ${semanticFiltered.length} (threshold: ${semanticThreshold})`);
    
    semanticFiltered.forEach((hit, rank) => {
        const rrfScore = calculateRRFScore(rank, weights.normalizedSemanticWeight / models.length, k);
        
        if (documentScores.has(hit._id)) {
          const existing = documentScores.get(hit._id)!;
          existing.rrfScore += rrfScore;
        } else {
          documentScores.set(hit._id, { hit, rrfScore });
        }
      });
  });
  
  // Sort by RRF score and take top N
  const sortedHits = Array.from(documentScores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, size)
    .map(({ hit, rrfScore }) => ({
      ...hit,
      _score: rrfScore
    }));
  
  console.log(`Final multi-model hybrid results: ${sortedHits.length} documents (from ${documentScores.size} unique)`);
  
  const filteredSemanticQueries = semanticResults.flatMap((r, i) =>
    r.esQuery ? [{ model: models[i], query: r.esQuery as ESSearchQuery }] : []
  );

  return {
    took: Math.max(...results.map(r => r.took || 0)),
    total: documentScores.size,
    hits: sortedHits,
    esQuery: {
      note: 'Multi-model hybrid search with pre-computed embeddings',
      balance,
      k,
      weights: {
        keyword: {
          raw: weights.keywordWeight,
          normalized: weights.normalizedKeywordWeight
        },
        semantic: {
          raw: weights.semanticWeight,
          normalized: weights.normalizedSemanticWeight,
          perModel: weights.normalizedSemanticWeight / models.length
        }
      },
      models: models,
      keywordQuery: keywordResults.esQuery as ESSearchQuery | undefined,
      semanticQueries: filteredSemanticQueries.length ? filteredSemanticQueries : undefined
    }
  };
}

// Hybrid search with pre-computed embeddings
export async function performHybridSearchWithEmbeddings(
  query: string,
  embeddings: Partial<Record<ModelKey, number[]>>,
  models: ModelKey | ModelKey[],
  size: number = 20,
  includeDescriptions: boolean = false,
  balance: number = 0.5,
  filters?: SearchFilters
): Promise<SearchResponseWithQuery> {
  try {
    const modelsArray = Array.isArray(models) ? models : [models];

    if (modelsArray.length === 1) {
      const model = modelsArray[0];
      const embedding = embeddings[model];

      if (!embedding) {
        throw new Error(`No embedding found for model ${model}`);
      }

      return await performSingleEmbeddingHybridSearchWithEmbedding(
        query,
        embedding,
        model,
        size,
        includeDescriptions,
        balance,
        filters
      );
    } else {
      // Filter to only models we have embeddings for
      const availableModels = modelsArray.filter((m) => embeddings[m]);

      if (availableModels.length === 0) {
        throw new Error('No embeddings available for requested models');
      }

      return await performMultipleEmbeddingHybridSearchWithEmbeddings(
        query,
        embeddings,
        availableModels,
        size,
        includeDescriptions,
        balance,
        filters
      );
    }
  } catch (error) {
    console.error('Hybrid search with embeddings error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Similar artworks search using KNN
export async function findSimilarArtworks(
  artworkId: string,
  model: ModelKey,
  size: number = 20
): Promise<SearchResponse> {
  try {
    const client = getElasticsearchClient();
    
    // First get the artwork's embedding
    const artwork = await client.get({
      index: INDEX_NAME,
      id: artworkId,
    });

    const embedding = (artwork._source as SearchHit['_source'])?.embeddings?.[model];
    if (!embedding) {
      console.log(`No ${model} embedding found for artwork ${artworkId}`);
      return { took: 0, total: 0, hits: [] };
    }

    // Search for similar artworks
    const response = await client.search({
      index: INDEX_NAME,
      size: size + 1, // +1 to exclude self
      _source: ARTWORK_SUMMARY_FIELDS,
      knn: {
        field: `embeddings.${model}`,
        query_vector: embedding,
        k: size + 1,
        num_candidates: (size + 1) * SEARCH_CONSTANTS.MULTIPLIERS.CANDIDATES
      }
    });

    // Filter out the source artwork
    const hits = (response.hits.hits as ESResponse['hits']['hits']).filter((hit: ESResponse['hits']['hits'][0]) => hit._id !== artworkId);

    return {
      took: response.took,
      total: hits.length,
      hits: hits.slice(0, size).map((hit: ESResponse['hits']['hits'][0]) => ({
        _id: hit._id,
        _score: hit._score || 0,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error(`Similar artworks search error for ${model}:`, error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Metadata-based similarity search using Elasticsearch fields
export async function findMetadataSimilarArtworks(
  artworkId: string,
  size: number = 20
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();
    
    // First get the source artwork
    const sourceArtwork = await client.get({
      index: INDEX_NAME,
      id: artworkId,
    });

    const source = sourceArtwork._source as SearchHit['_source'];
    if (!source) {
      throw new Error(`No source data found for artwork ${artworkId}`);
    }

    // Build a complex query based on metadata similarity
    // Weights based on art historical importance
    const shouldClauses: Array<Record<string, unknown>> = [];
    
    // 1. Artist - Highest weight (same artist = very similar)
    // Check nested artists array if available
    if (source.artists && source.artists.length > 0) {
      // Match any artist by constituentId (most precise)
      const artistIds = source.artists
        .filter(a => a.constituentId)
        .map(a => a.constituentId);
      
      if (artistIds.length > 0) {
        shouldClauses.push({
          nested: {
            path: 'artists',
            query: {
              terms: {
                'artists.constituentId': artistIds,
                boost: METADATA_FIELD_WEIGHTS.artist * 1.5
              }
            }
          }
        });
      }
      
      // Also match on artist names
      const artistNames = source.artists
        .map(a => a.displayName)
        .filter(name => name && name !== 'Unknown');
      
      if (artistNames.length > 0) {
        shouldClauses.push({
          nested: {
            path: 'artists',
            query: {
              bool: {
                should: artistNames.map(name => ({
                  match: {
                    'artists.displayName': {
                      query: name,
                      boost: METADATA_FIELD_WEIGHTS.artist
                    }
                  }
                }))
              }
            }
          }
        });
      }
    } else {
      // Fallback to deprecated single artist fields
      if (source.artistId) {
        shouldClauses.push({
          term: {
            'artistId': {
              value: source.artistId,
              boost: METADATA_FIELD_WEIGHTS.artist * 1.2
            }
          }
        });
      }
      if (source.artist && source.artist !== 'Unknown') {
        shouldClauses.push({
          match: {
            'artist': {
              query: source.artist,
              boost: METADATA_FIELD_WEIGHTS.artist
            }
          }
        });
      }
    }
    
    // 2. Date range - Very important (works from same period)
    if (source.dateBegin || source.dateEnd) {
      const centerYear = source.dateBegin && source.dateEnd 
        ? Math.round((source.dateBegin + source.dateEnd) / 2)
        : source.dateBegin || source.dateEnd;
      
      // Gaussian decay function: full score within 10 years, decaying over 50 years
      shouldClauses.push({
        function_score: {
          functions: [{
            gauss: {
              'dateBegin': {
                origin: centerYear,
                scale: 25,  // 25 years is the "scale" where score = 0.5
                decay: 0.5
              }
            }
          }],
          boost: METADATA_FIELD_WEIGHTS.date
        }
      });
    }
    
    // 3. Medium - Important (same materials/technique)
    if (source.medium) {
      shouldClauses.push({
        match: {
          'medium': {
            query: source.medium,
            boost: METADATA_FIELD_WEIGHTS.medium,
            fuzziness: 'AUTO'
          }
        }
      });
    }
    
    // 4. Classification - Important (painting, sculpture, etc.)
    if (source.classification) {
      shouldClauses.push({
        term: {
          'classification': {
            value: source.classification,
            boost: METADATA_FIELD_WEIGHTS.classification
          }
        }
      });
    }
    
    // 5. Department - Moderately important
    if (source.department) {
      shouldClauses.push({
        term: {
          'department': {
            value: source.department,
            boost: METADATA_FIELD_WEIGHTS.department
          }
        }
      });
    }
    
    // 6. Culture/Nationality - Moderately important
    if (source.culture) {
      shouldClauses.push({
        term: {
          'culture': {
            value: source.culture,
            boost: METADATA_FIELD_WEIGHTS.culture
          }
        }
      });
    }
    
    if (source.artistNationality) {
      shouldClauses.push({
        term: {
          'artistNationality': {
            value: source.artistNationality,
            boost: METADATA_FIELD_WEIGHTS.artistNationality
          }
        }
      });
    }
    
    // 7. Period/Dynasty - Less important
    if (source.period) {
      shouldClauses.push({
        term: {
          'period': {
            value: source.period,
            boost: METADATA_FIELD_WEIGHTS.period
          }
        }
      });
    }
    
    if (source.dynasty) {
      shouldClauses.push({
        term: {
          'dynasty': {
            value: source.dynasty,
            boost: METADATA_FIELD_WEIGHTS.dynasty
          }
        }
      });
    }
    
    // If no metadata fields could be used for similarity, return empty results
    if (shouldClauses.length === 0) {
      console.log(`No usable metadata fields for similarity search on artwork ${artworkId}`);
      return { took: 0, total: 0, hits: [] };
    }

    // Execute the search
    const searchBody: ESSearchQuery = {
      size: size + 1, // +1 to exclude self
      query: {
        bool: {
          should: shouldClauses,
          must_not: [
            { term: { _id: artworkId } } // Exclude the source artwork
          ],
          minimum_should_match: 1
        }
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody,
      _source: ARTWORK_SUMMARY_FIELDS
    });

    const hits = mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']).slice(0, size);
    const esQuery = {
      ...searchBody,
      note: 'Metadata-based similarity using art historical principles',
      sourceArtwork: {
        id: artworkId,
        artistId: source.artistId,
        artist: source.artist,
        date: `${source.dateBegin || '?'}-${source.dateEnd || '?'}`,
        medium: source.medium,
        classification: source.classification
      }
    } as ESSearchQuery & { note: string; sourceArtwork: Record<string, unknown> };

    return buildSearchResponse(response, hits, { esQuery });
  } catch (error) {
    console.error('Metadata similarity search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Combined similarity search using multiple embeddings and metadata
export async function findCombinedSimilarArtworks(
  artworkId: string,
  models: ModelKey[],
  size: number = 20,
  weights?: Record<ModelKey | 'metadata', number>
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();
    
    // First get the artwork's embeddings
    const artwork = await client.get({
      index: INDEX_NAME,
      id: artworkId,
    });

    const embeddings = (artwork._source as SearchHit['_source'])?.embeddings;
    if (!embeddings) {
      console.log(`No embeddings found for artwork ${artworkId}`);
      return { took: 0, total: 0, hits: [] };
    }

    // Check which requested models have embeddings
    const availableModels = models.filter(model => embeddings[model]);
    if (availableModels.length === 0) {
      console.log(`No embeddings found for requested models: ${models.join(', ')} for artwork ${artworkId}`);
      return { took: 0, total: 0, hits: [] };
    }

    // Default equal weights if not specified
    // Include metadata weight (default 0.3 to give embeddings more influence)
    const defaultWeights = {
      ...availableModels.reduce((acc, model) => ({
        ...acc,
        [model]: 0.35 // 35% each for 2 embeddings
      }), {} as Record<ModelKey, number>),
      metadata: 0.3 // 30% for metadata
    };
    const modelWeights = weights || defaultWeights;

    // Run parallel searches for each model + metadata search
    const searchPromises: Promise<ESResponse | (SearchResponse & { esQuery?: ESSearchQuery })>[] = [];
    
    // Embedding searches
    const searchSize = size * SEARCH_CONSTANTS.MULTIPLIERS.RESULTS;
    availableModels.forEach(model => {
      searchPromises.push(
        client.search({
          index: INDEX_NAME,
          size: searchSize,
          _source: ARTWORK_SUMMARY_FIELDS,
          knn: {
            field: `embeddings.${model}`,
            query_vector: embeddings[model],
            k: searchSize,
            num_candidates: searchSize * SEARCH_CONSTANTS.MULTIPLIERS.RESULTS
          }
        })
      );
    });
    
    // Add metadata similarity search
    searchPromises.push(
      findMetadataSimilarArtworks(artworkId, searchSize)
        .then(result => ({
          hits: {
            hits: result.hits.map(hit => ({
              _id: hit._id,
              _score: hit._score,
              _source: hit._source
            }))
          },
          took: result.took
        }))
    );

    const results = await Promise.all(searchPromises);
    
    // Combine results using weighted RRF
    const documentScores = new Map<string, { hit: SearchHit & { _metadata?: { sources: string[] } }, combinedScore: number, sources: string[] }>();
    const k = SEARCH_CONSTANTS.RRF.DEFAULT_K; // RRF constant for combined similarity
    
    // Process results from each embedding model
    availableModels.forEach((model, modelIndex) => {
      const modelWeight = modelWeights[model as keyof typeof modelWeights] || defaultWeights[model as keyof typeof defaultWeights];
      const searchResult = results[modelIndex];
      
      searchResult.hits.hits
        .filter((hit: ESResponse['hits']['hits'][0]) => (hit._score || 0) >= getScoreThreshold('similarity'))
        .forEach((hit: ESResponse['hits']['hits'][0], rank: number) => {
          // Skip the source artwork
          if (hit._id === artworkId) return;
          
          const rrfScore = calculateRRFScore(rank, modelWeight, k);
          
          if (documentScores.has(hit._id)) {
            const existing = documentScores.get(hit._id)!;
            existing.combinedScore += rrfScore;
            existing.sources.push(model);
          } else {
            documentScores.set(hit._id, { 
              hit: {
                _id: hit._id,
                _score: hit._score || 0,
                _source: hit._source
              } as SearchHit,
              combinedScore: rrfScore, 
              sources: [model] 
            });
          }
        });
    });
    
    // Process metadata similarity results with score filtering
    const metadataWeight = modelWeights.metadata || defaultWeights.metadata;
    const metadataResult = results[results.length - 1]; // Last result is metadata
    
    metadataResult.hits.hits
      .filter((hit: SearchHit) => hit._score >= getScoreThreshold('metadata'))
      .forEach((hit: SearchHit, rank: number) => {
        // Skip the source artwork
        if (hit._id === artworkId) return;
        
        const rrfScore = calculateRRFScore(rank, metadataWeight, k);
        
        if (documentScores.has(hit._id)) {
          const existing = documentScores.get(hit._id)!;
          existing.combinedScore += rrfScore;
          existing.sources.push('metadata');
        } else {
          documentScores.set(hit._id, { hit, combinedScore: rrfScore, sources: ['metadata'] });
        }
      });
    
    // Sort by combined score and take top N
    const sortedHits = Array.from(documentScores.values())
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, size)
      .map(({ hit, combinedScore, sources }) => ({
        _id: hit._id,
        _score: combinedScore,
        _source: hit._source,
        // Include source info in metadata for debugging
        _metadata: { sources }
      }));
    
    return {
      took: Math.max(...results.map((r: SearchResponse) => r.took || 0)),
      total: sortedHits.length,
      hits: sortedHits,
      // Return a custom query structure for combined search
      // This doesn't follow ESHybridQuery structure since it includes metadata
      esQuery: undefined
    };
  } catch (error) {
    console.error('Combined similar artworks search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Get index statistics
export async function getIndexStats() {
  try {
    const client = getElasticsearchClient();
    const stats = await client.indices.stats({ index: INDEX_NAME });
    
    return {
      indexName: INDEX_NAME,
      indexSize: stats._all?.total?.store?.size_in_bytes || 0,
      indexSizeHuman: formatBytes(stats._all?.total?.store?.size_in_bytes || 0),
      totalDocuments: stats._all?.total?.docs?.count || 0,
    };
  } catch (error) {
    console.error('Error getting index stats:', error);
    return null;
  }
}

// Get a single artwork by ID
export async function getArtworkById(id: string): Promise<Artwork | null> {
  try {
    const client = getElasticsearchClient();
    const response = await client.get({
      index: INDEX_NAME,
      id,
      _source_excludes: ['embeddings']
    });
    
    return response._source as Artwork;
  } catch (error) {
    console.error(`Error getting artwork ${id}:`, error);
    return null;
  }
}

// Hydrate similar artworks with full document data
export async function hydrateSimilarArtworks(
  similarArtworks: SimilarArtwork[] | undefined
): Promise<SearchHit[]> {
  if (!similarArtworks || similarArtworks.length === 0) {
    return [];
  }

  const client = getElasticsearchClient();
  
  try {
    // Fetch all similar artworks in one query
    const response = await client.mget({
      index: INDEX_NAME,
      ids: similarArtworks.map(sa => sa.id),
      _source: ARTWORK_SUMMARY_FIELDS
    });

    // Convert to SearchHit format with similarity info
    const hits: SearchHit[] = [];
    
    similarArtworks.forEach((sim, index) => {
      const doc = response.docs[index];
      // Check if doc is a successful response (not an error)
      if ('_source' in doc && doc._source) {
        // Add similarity info to the artwork
        const enhancedArtwork = {
          ...doc._source as Artwork,
          _similarityInfo: sim
        };
        
        hits.push({
          _id: sim.id,
          _score: sim.confidence,
          _source: enhancedArtwork as Artwork
        });
      }
    });
    
    return hits;
  } catch (error) {
    console.error('Error hydrating similar artworks:', error);
    return [];
  }
}

// Get all unique emojis in the collection
export async function getAllEmojis(): Promise<{ emoji: string; count: number }[]> {
  try {
    const client = getElasticsearchClient();
    
    console.log('Fetching emojis from index:', INDEX_NAME);
    
    // First check if any documents have the visual_emoji_array field
    const checkField = await client.search({
      index: INDEX_NAME,
      size: 1,
      query: {
        exists: {
          field: 'visual_description.emoji_array'
        }
      },
      _source: ['visual_description.emoji_array']
    });
    
    console.log('Documents with visual_description.emoji_array:', (checkField.hits.total as { value: number }).value);
    
    if (checkField.hits.hits.length > 0) {
      console.log('Sample visual_description.emoji_array:', checkField.hits.hits[0]._source);
    }
    
    const response = await client.search({
      index: INDEX_NAME,
      size: 0,
      aggs: {
        unique_emojis: {
          terms: {
            field: 'visual_description.emoji_array',
            size: 1000  // Get up to 1000 unique emojis
          }
        }
      }
    });

    console.log('Aggregation response:', JSON.stringify(response.aggregations, null, 2));

    // Type guard to check if the aggregation has buckets
    const agg = response.aggregations?.unique_emojis;
    const buckets = (agg && 'buckets' in agg) ? 
      (agg.buckets as Array<{ key: string; doc_count: number }>) : 
      [];
    
    console.log(`Found ${buckets.length} unique emojis`);
    
    return buckets.map(bucket => ({
      emoji: bucket.key,
      count: bucket.doc_count
    }));
  } catch (error) {
    console.error('Error fetching emojis:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
    }
    return [];
  }
}

// Get all unique tags in the collection
export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
  try {
    const client = getElasticsearchClient();
    
    const response = await client.search({
      index: INDEX_NAME,
      size: 0,
      aggs: {
        unique_tags: {
          terms: {
            field: 'tags',
            size: 5000  // Get up to 5000 unique tags
          }
        }
      }
    });

    // Type guard to check if the aggregation has buckets
    const agg = response.aggregations?.unique_tags;
    const buckets = (agg && 'buckets' in agg) ? 
      (agg.buckets as Array<{ key: string; doc_count: number }>) : 
      [];
    
    return buckets.map(bucket => ({
      tag: bucket.key,
      count: bucket.doc_count
    })).sort((a, b) => b.count - a.count); // Sort by count descending
  } catch (error) {
    console.error('Error fetching tags:', error);
    return [];
  }
}

// Filter options type for UI dropdowns
export interface FilterOptions {
  departments: { value: string; count: number }[];
  classifications: { value: string; count: number }[];
  cultures: { value: string; count: number }[];
  mediums: { value: string; count: number }[];
  tags: { value: string; count: number }[];
  dateRange: { min: number; max: number };
}

// Get all filter options in a single efficient query
export async function getFilterOptions(): Promise<FilterOptions> {
  try {
    const client = getElasticsearchClient();

    const response = await client.search({
      index: INDEX_NAME,
      size: 0,
      aggs: {
        departments: {
          terms: {
            field: 'department',
            size: 100
          }
        },
        classifications: {
          terms: {
            field: 'classification',
            size: 100
          }
        },
        cultures: {
          terms: {
            field: 'culture',
            size: 200
          }
        },
        mediums: {
          terms: {
            field: 'medium.keyword',
            size: 200
          }
        },
        tags: {
          terms: {
            field: 'tags',
            size: 100  // Top 100 tags for UI
          }
        },
        min_date: {
          min: {
            field: 'dateBegin'
          }
        },
        max_date: {
          max: {
            field: 'dateEnd'
          }
        }
      }
    });

    // Helper to extract buckets from aggregation
    const extractBuckets = (aggName: string): { value: string; count: number }[] => {
      const agg = response.aggregations?.[aggName];
      const buckets = (agg && 'buckets' in agg)
        ? (agg.buckets as Array<{ key: string; doc_count: number }>)
        : [];
      return buckets
        .map(b => ({ value: b.key, count: b.doc_count }))
        .sort((a, b) => b.count - a.count);
    };

    // Extract min/max dates
    const minDateAgg = response.aggregations?.min_date;
    const maxDateAgg = response.aggregations?.max_date;
    const minDate = (minDateAgg && 'value' in minDateAgg) ? minDateAgg.value as number : -3000;
    const maxDate = (maxDateAgg && 'value' in maxDateAgg) ? maxDateAgg.value as number : new Date().getFullYear();

    return {
      departments: extractBuckets('departments'),
      classifications: extractBuckets('classifications'),
      cultures: extractBuckets('cultures'),
      mediums: extractBuckets('mediums'),
      tags: extractBuckets('tags'),
      dateRange: {
        min: Math.floor(minDate),
        max: Math.ceil(maxDate)
      }
    };
  } catch (error) {
    console.error('Error fetching filter options:', error);
    return {
      departments: [],
      classifications: [],
      cultures: [],
      mediums: [],
      tags: [],
      dateRange: { min: -3000, max: new Date().getFullYear() }
    };
  }
}

// Valid filter field names for searching
type FilterField = 'departments' | 'classifications' | 'cultures' | 'mediums' | 'tags' | 'countries' | 'periods';

const FILTER_FIELD_MAPPING: Record<FilterField, string> = {
  departments: 'department',
  classifications: 'classification',
  cultures: 'culture',
  mediums: 'medium.keyword',
  tags: 'tags',
  countries: 'country',
  periods: 'period',
};

/**
 * Search for filter values matching a query string.
 * Useful for typeahead/autocomplete or finding specific filter values.
 *
 * @param query - Case-insensitive search string (e.g., "japan", "portrait")
 * @param field - Optional: limit search to specific field(s)
 * @param limit - Max results per field (default 20)
 */
export async function searchFilterOptions(
  query: string,
  field?: FilterField | FilterField[],
  limit: number = 20
): Promise<Partial<Record<FilterField, { value: string; count: number }[]>>> {
  try {
    const client = getElasticsearchClient();
    const lowerQuery = query.toLowerCase();

    // Determine which fields to search
    const fieldsToSearch: FilterField[] = field
      ? (Array.isArray(field) ? field : [field])
      : ['departments', 'classifications', 'cultures', 'mediums', 'tags', 'countries', 'periods'];

    // Build aggregations with include pattern for case-insensitive matching
    // Using a large size and filtering client-side for flexibility
    const aggs: Record<string, { terms: { field: string; size: number } }> = {};

    for (const f of fieldsToSearch) {
      const esField = FILTER_FIELD_MAPPING[f];
      aggs[f] = {
        terms: {
          field: esField,
          size: 1000 // Fetch many to filter client-side
        }
      };
    }

    const response = await client.search({
      index: INDEX_NAME,
      size: 0,
      aggs
    });

    // Extract and filter buckets
    const results: Partial<Record<FilterField, { value: string; count: number }[]>> = {};

    for (const f of fieldsToSearch) {
      const agg = response.aggregations?.[f];
      const buckets = (agg && 'buckets' in agg)
        ? (agg.buckets as Array<{ key: string; doc_count: number }>)
        : [];

      // Filter buckets by query (case-insensitive contains)
      const filtered = buckets
        .filter(b => b.key.toLowerCase().includes(lowerQuery))
        .slice(0, limit)
        .map(b => ({ value: b.key, count: b.doc_count }));

      if (filtered.length > 0) {
        results[f] = filtered;
      }
    }

    return results;
  } catch (error) {
    console.error('Error searching filter options:', error);
    return {};
  }
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
