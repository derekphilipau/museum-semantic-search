import { Client } from '@elastic/elasticsearch';
// @ts-expect-error - TypeScript can't find the module but it exists
import type { SearchResponse as ESResponse } from '@elastic/elasticsearch/lib/api/types';
import { ModelKey } from '@/lib/embeddings/types';
import { SearchResponse, SearchHit, ESSearchQuery, ESHybridQuery, Artwork } from '@/app/types';

export function getElasticsearchClient(): Client {
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;
  
  console.log('Initializing Elasticsearch client:', {
    url: esUrl,
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'none',
    hasCloudId: !!cloudId,
    urlIncludes: esUrl.includes('elastic-cloud.com'),
    nodeEnv: process.env.NODE_ENV
  });
  
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
  
  console.log(`Elasticsearch client initialized: ${cloudId ? 'Cloud' : esUrl}`);
  return newClient;
}

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 
                          process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 
                          'artworks_semantic';

// Search functions by type

export async function performKeywordSearch(
  query: string,
  size: number = 20,
  includeDescriptions: boolean = false
): Promise<SearchResponse & { esQuery?: ESSearchQuery }> {
  try {
    const client = getElasticsearchClient();
    
    const searchFields = [
      'metadata.title^3',
      'metadata.artist^2',
      'metadata.classification^1.5',
      'metadata.medium',
      'metadata.date',
      'metadata.artistNationality',
      'metadata.department'
    ];
    
    // Add visual description fields if requested
    if (includeDescriptions) {
      searchFields.push(
        'visual_alt_text^0.8',
        'visual_long_description^0.5'
      );
    }
    
    const searchBody = {
      size,
      _source: {
        excludes: ['embeddings']
      },
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

    return {
      took: response.took,
      total: (response.hits.total as { value: number }).value,
      hits: (response.hits.hits as ESResponse['hits']['hits']).map((hit: ESResponse['hits']['hits'][0]) => ({
        _id: hit._id,
        _score: hit._score || 0,
        _source: hit._source
      })),
      esQuery: searchBody
    };
  } catch (error) {
    console.error('Keyword search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}


// Helper function to perform semantic search with pre-computed embedding
export async function performSemanticSearchWithEmbedding(
  embedding: number[],
  model: ModelKey,
  size: number = 20
): Promise<SearchResponse & { esQuery?: ESSearchQuery }> {
  try {
    const client = getElasticsearchClient();

    const searchBody = {
      size,
      _source: {
        excludes: ['embeddings']
      },
      knn: {
        field: `embeddings.${model}`,
        query_vector: embedding,
        k: size,
        num_candidates: size * 2
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      ...searchBody
    });

    return {
      took: response.took,
      total: (response.hits.total as { value: number }).value,
      hits: (response.hits.hits as ESResponse['hits']['hits']).map((hit: ESResponse['hits']['hits'][0]) => ({
        _id: hit._id,
        _score: hit._score || 0,
        _source: hit._source
      })),
      esQuery: {
        ...searchBody,
        knn: {
          ...searchBody.knn,
          query_vector: '[embedding vector]' // Don't include full vector in UI
        }
      }
    };
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
): Promise<SearchResponse & { esQuery?: ESHybridQuery }> {
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
        k: 30,
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
        k: 30,
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
  searchPromises.push(performKeywordSearch(query, size * 2, includeDescriptions));
  
  // Semantic search
  searchPromises.push(performSemanticSearchWithEmbedding(embedding, model, size * 2));
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results[1];
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: SearchHit, rrfScore: number, keywordRank?: number, semanticRank?: number }>();
  
  // Use smaller k for more pronounced differences
  // k=10 is more aggressive, k=60 is more conservative
  // We'll use a dynamic k based on the balance to make the effect more noticeable
  const k = 10 + (1 - Math.abs(balance - 0.5) * 2) * 20; // k ranges from 10 to 30
  
  // Apply balance weights with exponential scaling for more pronounced effect
  // This makes extreme balance values (near 0 or 1) have stronger effects
  const keywordWeight = Math.pow(1 - balance, 1.5);
  const semanticWeight = Math.pow(balance, 1.5);
  
  // Normalize weights so they sum to 1
  const totalWeight = keywordWeight + semanticWeight;
  const normalizedKeywordWeight = keywordWeight / totalWeight;
  const normalizedSemanticWeight = semanticWeight / totalWeight;

  // Process keyword results
  keywordResults.hits.forEach((hit, rank) => {
    const rrfScore = normalizedKeywordWeight * (1 / (k + rank + 1));
    documentScores.set(hit._id, { hit, rrfScore, keywordRank: rank });
  });
  
  // Process semantic results
  semanticResults.hits.forEach((hit, rank) => {
    const rrfScore = normalizedSemanticWeight * (1 / (k + rank + 1));
    
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
          raw: keywordWeight,
          normalized: normalizedKeywordWeight
        },
        semantic: {
          raw: semanticWeight,
          normalized: normalizedSemanticWeight
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
): Promise<SearchResponse & { esQuery?: ESHybridQuery }> {
  // Run parallel searches: one keyword + one knn per model
  const searchPromises: Promise<SearchResponse & { esQuery?: ESSearchQuery | ESHybridQuery }>[] = [];
  
  // Keyword search
  searchPromises.push(performKeywordSearch(query, size * 2, includeDescriptions));
  
  // Semantic searches using pre-computed embeddings
  for (const model of models) {
    if (embeddings[model as ModelKey]) {
      searchPromises.push(performSemanticSearchWithEmbedding(embeddings[model as ModelKey] as number[], model, size * 2));
    }
  }
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results.slice(1);
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: SearchHit, rrfScore: number }>();
  
  // Use smaller k for more pronounced differences
  const k = 10 + (1 - Math.abs(balance - 0.5) * 2) * 20; // k ranges from 10 to 30
  
  // Apply balance weights with exponential scaling
  const keywordWeight = Math.pow(1 - balance, 1.5);
  const semanticWeight = Math.pow(balance, 1.5);
  
  // Normalize weights
  const totalWeight = keywordWeight + semanticWeight;
  const normalizedKeywordWeight = keywordWeight / totalWeight;
  const normalizedSemanticWeight = semanticWeight / totalWeight;

  // Process keyword results
  keywordResults.hits.forEach((hit, rank) => {
    const rrfScore = normalizedKeywordWeight * (1 / (k + rank + 1));
    documentScores.set(hit._id, { hit, rrfScore });
  });
  
  // Process semantic results
  semanticResults.forEach((result) => {
    result.hits.forEach((hit, rank) => {
      const rrfScore = (normalizedSemanticWeight / models.length) * (1 / (k + rank + 1));
      
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
          raw: keywordWeight,
          normalized: normalizedKeywordWeight
        },
        semantic: {
          raw: semanticWeight,
          normalized: normalizedSemanticWeight,
          perModel: normalizedSemanticWeight / models.length
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
): Promise<SearchResponse & { esQuery?: ESHybridQuery }> {
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
    const response = await client.search({
      index: INDEX_NAME,
      size: size + 1, // +1 to exclude self
      _source: {
        excludes: ['embeddings']
      },
      knn: {
        field: `embeddings.${model}`,
        query_vector: embedding,
        k: size + 1,
        num_candidates: (size + 1) * 2
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
): Promise<SearchResponse & { esQuery?: ESSearchQuery }> {
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
            boost: 10
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
          boost: 7
        }
      });
    }
    
    // 3. Medium - Important (same materials/technique)
    if (metadata.medium) {
      shouldClauses.push({
        match: {
          'metadata.medium': {
            query: metadata.medium,
            boost: 6,
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
            boost: 5
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
            boost: 4
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
            boost: 4
          }
        }
      });
    }
    
    if (metadata.artistNationality) {
      shouldClauses.push({
        term: {
          'metadata.artistNationality': {
            value: metadata.artistNationality,
            boost: 4
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
          boost: 3
        }
      });
    }
    
    // 8. Period/Dynasty - Less important
    if (metadata.period) {
      shouldClauses.push({
        term: {
          'metadata.period': {
            value: metadata.period,
            boost: 3
          }
        }
      });
    }
    
    if (metadata.dynasty) {
      shouldClauses.push({
        term: {
          'metadata.dynasty': {
            value: metadata.dynasty,
            boost: 3
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
      size: size + 1, // +1 to exclude self
      _source: {
        excludes: ['embeddings']
      },
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

    return {
      took: response.took,
      total: (response.hits.total as { value: number }).value,
      hits: (response.hits.hits as ESResponse['hits']['hits']).slice(0, size).map((hit: ESResponse['hits']['hits'][0]) => ({
        _id: hit._id,
        _score: hit._score || 0,
        _source: hit._source
      })),
      esQuery: {
        ...searchBody,
        note: 'Metadata-based similarity using art historical principles',
        sourceArtwork: {
          id: artworkId,
          artist: metadata.artist,
          date: `${metadata.dateBegin || '?'}-${metadata.dateEnd || '?'}`,
          medium: metadata.medium,
          classification: metadata.classification
        }
      } as ESSearchQuery & { note: string; sourceArtwork: Record<string, unknown> }
    };
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
): Promise<SearchResponse & { esQuery?: ESHybridQuery }> {
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
    availableModels.forEach(model => {
      searchPromises.push(
        client.search({
          index: INDEX_NAME,
          size: size * 2, // Get more results for better fusion
          _source: {
            excludes: ['embeddings']
          },
          knn: {
            field: `embeddings.${model}`,
            query_vector: embeddings[model],
            k: size * 2,
            num_candidates: size * 4
          }
        })
      );
    });
    
    // Add metadata similarity search
    searchPromises.push(
      findMetadataSimilarArtworks(artworkId, size * 2)
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
    const k = 20; // RRF constant for more aggressive ranking
    
    // Process results from each embedding model
    availableModels.forEach((model, modelIndex) => {
      const modelWeight = modelWeights[model as keyof typeof modelWeights] || defaultWeights[model as keyof typeof defaultWeights];
      const searchResult = results[modelIndex];
      
      searchResult.hits.hits.forEach((hit: ESResponse['hits']['hits'][0], rank: number) => {
        // Skip the source artwork
        if (hit._id === artworkId) return;
        
        const rrfScore = modelWeight * (1 / (k + rank + 1));
        
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
    
    // Process metadata similarity results
    const metadataWeight = modelWeights.metadata || defaultWeights.metadata;
    const metadataResult = results[results.length - 1]; // Last result is metadata
    
    metadataResult.hits.hits.forEach((hit: SearchHit, rank: number) => {
      // Skip the source artwork
      if (hit._id === artworkId) return;
      
      const rrfScore = metadataWeight * (1 / (k + rank + 1));
      
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

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}