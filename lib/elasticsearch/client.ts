import { Client } from '@elastic/elasticsearch';
// @ts-expect-error - TypeScript can't find the module but it exists
import type { SearchResponse as ESResponse } from '@elastic/elasticsearch/lib/api/types';
import { ModelKey } from '@/lib/embeddings/types';
import { SearchResponse, SearchHit, SearchResponseWithQuery, ESSearchQuery, ESHybridQuery, Artwork } from '@/app/types';

// ============================================================================
// Constants
// ============================================================================

const SEARCH_CONSTANTS = {
  // Score thresholds for filtering results
  SCORE_THRESHOLDS: {
    KEYWORD: 10.0,        // Lowered to allow more keyword matches in hybrid search
    JINA_V3: 0.71,        // Threshold for Jina v3 text embeddings
    SIGLIP2: 0.58,        // Threshold for SigLIP 2 image embeddings
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
    'metadata.title^3',
    'metadata.artist^2', 
    'metadata.classification^1.5',
    'metadata.medium',
    'metadata.date',
    'metadata.artistNationality',
    'metadata.department'
  ],
  DESCRIPTIONS: [
    'visual_alt_text^0.8',
    'visual_long_description^0.5'
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
  dimensions: 3,
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
    jina_v3: SEARCH_CONSTANTS.SCORE_THRESHOLDS.JINA_V3,
    siglip2: SEARCH_CONSTANTS.SCORE_THRESHOLDS.SIGLIP2,
    similarity: SEARCH_CONSTANTS.SCORE_THRESHOLDS.SIMILARITY,
    metadata: SEARCH_CONSTANTS.SCORE_THRESHOLDS.METADATA
  };
  return thresholds[model] || 0;
}

/**
 * Builds base search configuration
 */
function buildBaseSearchConfig(size: number, excludeEmbeddings: boolean = true) {
  return {
    size,
    _source: excludeEmbeddings ? { excludes: ['embeddings'] } : undefined
  };
}

export function getElasticsearchClient(): Client {
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;
    
  // Check if we're using Elastic Cloud
  let newClient: Client;
  
  if (cloudId && apiKey) {
    // Elastic Cloud configuration
    newClient = new Client({
      cloud: {
        id: cloudId
      },
      auth: {
        apiKey: apiKey
      }
    });
  } else if (apiKey && (esUrl.includes('elastic.co') || esUrl.includes('elastic-cloud.com'))) {
    // Elastic Cloud with URL (alternative setup)
    newClient = new Client({
      node: esUrl,
      auth: {
        apiKey: apiKey
      }
    });
  } else {
    // Local Elasticsearch (no auth required)
    newClient = new Client({
      node: esUrl
    });
  }
  
  return newClient;
}

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 'artworks_semantic';

// Search functions by type

export async function performKeywordSearch(
  query: string,
  size: number = 20,
  includeDescriptions: boolean = false
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();
    
    const searchFields = includeDescriptions 
      ? [...SEARCH_FIELDS.BASE, ...SEARCH_FIELDS.DESCRIPTIONS]
      : SEARCH_FIELDS.BASE;
    
    const searchBody = {
      ...buildBaseSearchConfig(size),
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: searchFields,
              type: 'best_fields' as const,
              fuzziness: 'AUTO'
            }
          }]
        }
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody
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
            visual_emoji_array: emojis[0]
          }
        }
      : {
          // Multiple emojis: find artworks containing ALL
          bool: {
            must: emojis.map(emoji => ({
              term: {
                visual_emoji_array: emoji
              }
            }))
          }
        };
    
    const searchBody = {
      ...buildBaseSearchConfig(size),
      query
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody
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

// Helper function to perform semantic search with pre-computed embedding
export async function performSemanticSearchWithEmbedding(
  embedding: number[],
  model: ModelKey,
  size: number = 20
): Promise<SearchResponseWithQuery> {
  try {
    const client = getElasticsearchClient();

    const searchBody = {
      ...buildBaseSearchConfig(size),
      knn: {
        field: `embeddings.${model}`,
        query_vector: embedding,
        k: size,
        num_candidates: size * SEARCH_CONSTANTS.MULTIPLIERS.CANDIDATES
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody
    });

    const esQuery = {
      ...searchBody,
      knn: {
        ...searchBody.knn,
        query_vector: '[embedding vector]' // Don't include full vector in UI
      }
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
  balance: number = 0.5
): Promise<SearchResponseWithQuery> {
  // If balance is 1 (100% semantic), just do a pure KNN search
  if (balance >= 0.99) {
    const result = await performSemanticSearchWithEmbedding(embedding, model, size);
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
    const result = await performKeywordSearch(query, size, includeDescriptions);
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
  searchPromises.push(performKeywordSearch(query, searchSize, includeDescriptions));
  
  // Semantic search
  searchPromises.push(performSemanticSearchWithEmbedding(embedding, model, searchSize));
  
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
  embeddings: Record<ModelKey, number[]>,
  models: ModelKey[],
  size: number = 20,
  includeDescriptions: boolean = false,
  balance: number = 0.5
): Promise<SearchResponseWithQuery> {
  // Run parallel searches: one keyword + one knn per model
  const searchPromises: Promise<SearchResponse & { esQuery?: ESSearchQuery | ESHybridQuery }>[] = [];
  
  // Keyword search
  const searchSize = size * SEARCH_CONSTANTS.MULTIPLIERS.RESULTS;
  searchPromises.push(performKeywordSearch(query, searchSize, includeDescriptions));
  
  // Semantic searches using pre-computed embeddings
  for (const model of models) {
    if (embeddings[model as ModelKey]) {
      searchPromises.push(performSemanticSearchWithEmbedding(embeddings[model as ModelKey] as number[], model, searchSize));
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
      semanticQueries: semanticResults
        .map((r, i) => ({
          model: models[i],
          query: r.esQuery as ESSearchQuery | undefined
        }))
        .filter((sq): sq is { model: string; query: ESSearchQuery } => sq.query !== undefined)
    }
  };
}

// Hybrid search with pre-computed embeddings
export async function performHybridSearchWithEmbeddings(
  query: string,
  embeddings: { siglip2?: number[]; jina_v3?: number[] },
  models: ModelKey | ModelKey[],
  size: number = 20,
  includeDescriptions: boolean = false,
  balance: number = 0.5
): Promise<SearchResponseWithQuery> {
  try {
    const modelsArray = Array.isArray(models) ? models : [models];
    
    if (modelsArray.length === 1) {
      const model = modelsArray[0];
      const embedding = (embeddings as Record<ModelKey, number[]>)[model];
      
      if (!embedding) {
        throw new Error(`No embedding found for model ${model}`);
      }
      
      return await performSingleEmbeddingHybridSearchWithEmbedding(
        query,
        embedding,
        model,
        size,
        includeDescriptions,
        balance
      );
    } else {
      // Filter to only models we have embeddings for
      const availableModels = modelsArray.filter(m => embeddings[m as keyof typeof embeddings]);
      
      if (availableModels.length === 0) {
        throw new Error('No embeddings available for requested models');
      }
      
      return await performMultipleEmbeddingHybridSearchWithEmbeddings(
        query,
        embeddings as Record<ModelKey, number[]>,
        availableModels,
        size,
        includeDescriptions,
        balance
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
    const searchConfig = buildBaseSearchConfig(size + 1); // +1 to exclude self
    const response = await client.search({
      index: INDEX_NAME,
      ...searchConfig,
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

    const metadata = (sourceArtwork._source as SearchHit['_source'])?.metadata;
    if (!metadata) {
      throw new Error(`No metadata found for artwork ${artworkId}`);
    }

    // Build a complex query based on metadata similarity
    // Weights based on art historical importance
    const shouldClauses: Array<Record<string, unknown>> = [];
    
    // 1. Artist - Highest weight (same artist = very similar)
    if (metadata.artist && metadata.artist !== 'Unknown') {
      shouldClauses.push({
        match: {
          'metadata.artist': {
            query: metadata.artist,
            boost: METADATA_FIELD_WEIGHTS.artist
          }
        }
      });
    }
    
    // 2. Date range - Very important (works from same period)
    if (metadata.dateBegin || metadata.dateEnd) {
      const centerYear = metadata.dateBegin && metadata.dateEnd 
        ? Math.round((metadata.dateBegin + metadata.dateEnd) / 2)
        : metadata.dateBegin || metadata.dateEnd;
      
      // Gaussian decay function: full score within 10 years, decaying over 50 years
      shouldClauses.push({
        function_score: {
          functions: [{
            gauss: {
              'metadata.dateBegin': {
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
    if (metadata.medium) {
      shouldClauses.push({
        match: {
          'metadata.medium': {
            query: metadata.medium,
            boost: METADATA_FIELD_WEIGHTS.medium,
            fuzziness: 'AUTO'
          }
        }
      });
    }
    
    // 4. Classification - Important (painting, sculpture, etc.)
    if (metadata.classification) {
      shouldClauses.push({
        term: {
          'metadata.classification': {
            value: metadata.classification,
            boost: METADATA_FIELD_WEIGHTS.classification
          }
        }
      });
    }
    
    // 5. Department - Moderately important
    if (metadata.department) {
      shouldClauses.push({
        term: {
          'metadata.department': {
            value: metadata.department,
            boost: METADATA_FIELD_WEIGHTS.department
          }
        }
      });
    }
    
    // 6. Culture/Nationality - Moderately important
    if (metadata.culture) {
      shouldClauses.push({
        term: {
          'metadata.culture': {
            value: metadata.culture,
            boost: METADATA_FIELD_WEIGHTS.culture
          }
        }
      });
    }
    
    if (metadata.artistNationality) {
      shouldClauses.push({
        term: {
          'metadata.artistNationality': {
            value: metadata.artistNationality,
            boost: METADATA_FIELD_WEIGHTS.artistNationality
          }
        }
      });
    }
    
    // 7. Dimensions - Less important but relevant (similar scale)
    if (metadata.width && metadata.height) {
      // Similar dimensions (within 20%)
      shouldClauses.push({
        bool: {
          must: [
            {
              range: {
                'metadata.width': {
                  gte: metadata.width * 0.8,
                  lte: metadata.width * 1.2
                }
              }
            },
            {
              range: {
                'metadata.height': {
                  gte: metadata.height * 0.8,
                  lte: metadata.height * 1.2
                }
              }
            }
          ],
          boost: METADATA_FIELD_WEIGHTS.dimensions
        }
      });
    }
    
    // 8. Period/Dynasty - Less important
    if (metadata.period) {
      shouldClauses.push({
        term: {
          'metadata.period': {
            value: metadata.period,
            boost: METADATA_FIELD_WEIGHTS.period
          }
        }
      });
    }
    
    if (metadata.dynasty) {
      shouldClauses.push({
        term: {
          'metadata.dynasty': {
            value: metadata.dynasty,
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
    const searchBody = {
      ...buildBaseSearchConfig(size + 1), // +1 to exclude self
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
      ...searchBody
    });

    const hits = mapESResponseToSearchHits(response.hits.hits as ESResponse['hits']['hits']).slice(0, size);
    const esQuery = {
      ...searchBody,
      note: 'Metadata-based similarity using art historical principles',
      sourceArtwork: {
        id: artworkId,
        artist: metadata.artist,
        date: `${metadata.dateBegin || '?'}-${metadata.dateEnd || '?'}`,
        medium: metadata.medium,
        classification: metadata.classification
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
      const searchConfig = buildBaseSearchConfig(searchSize);
      searchPromises.push(
        client.search({
          index: INDEX_NAME,
          ...searchConfig,
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
          field: 'visual_emoji_array'
        }
      },
      _source: ['visual_emoji_array']
    });
    
    console.log('Documents with visual_emoji_array:', (checkField.hits.total as { value: number }).value);
    
    if (checkField.hits.hits.length > 0) {
      console.log('Sample visual_emoji_array:', checkField.hits.hits[0]._source);
    }
    
    const response = await client.search({
      index: INDEX_NAME,
      size: 0,
      aggs: {
        unique_emojis: {
          terms: {
            field: 'visual_emoji_array',
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

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}