import { Client } from '@elastic/elasticsearch';
import { ModelKey } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';

// Initialize Elasticsearch client singleton
let client: Client | null = null;

export function getElasticsearchClient(): Client {
  if (!client) {
    client = new Client({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    });
  }
  return client;
}

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 
                          process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 
                          'artworks_semantic';

// Search functions by type

export async function performKeywordSearch(
  query: string,
  size: number = 20,
  includeDescriptions: boolean = false
): Promise<SearchResponse & { esQuery?: any }> {
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
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          }]
        }
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      body: searchBody
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
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
): Promise<SearchResponse & { esQuery?: any }> {
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
      body: searchBody
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
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
): Promise<SearchResponse & { esQuery?: any }> {
  // If balance is 1 (100% semantic), just do a pure KNN search
  if (balance >= 0.99) {
    return performSemanticSearchWithEmbedding(embedding, model, size);
  }
  
  // If balance is 0 (100% keyword), just do keyword search
  if (balance <= 0.01) {
    return performKeywordSearch(query, size, includeDescriptions);
  }
  
  // For balanced search, use manual RRF like the multi-embedding version
  // Run parallel searches: keyword + semantic
  const searchPromises: Promise<any>[] = [];
  
  // Keyword search
  searchPromises.push(performKeywordSearch(query, size * 2, includeDescriptions));
  
  // Semantic search
  searchPromises.push(performSemanticSearchWithEmbedding(embedding, model, size * 2));
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results[1];
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: any, rrfScore: number, keywordRank?: number, semanticRank?: number }>();
  
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
  keywordResults.hits.forEach((hit: any, rank: number) => {
    const rrfScore = normalizedKeywordWeight * (1 / (k + rank + 1));
    documentScores.set(hit._id, { hit, rrfScore, keywordRank: rank });
  });
  
  // Process semantic results
  semanticResults.hits.forEach((hit: any, rank: number) => {
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
      keywordQuery: (keywordResults as any).esQuery,
      semanticQuery: (semanticResults as any).esQuery
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
): Promise<SearchResponse & { esQuery?: any }> {
  // Run parallel searches: one keyword + one knn per model
  const searchPromises: Promise<any>[] = [];
  
  // Keyword search
  searchPromises.push(performKeywordSearch(query, size * 2, includeDescriptions));
  
  // Semantic searches using pre-computed embeddings
  for (const model of models) {
    if (embeddings[model]) {
      searchPromises.push(performSemanticSearchWithEmbedding(embeddings[model], model, size * 2));
    }
  }
  
  const results = await Promise.all(searchPromises);
  const keywordResults = results[0];
  const semanticResults = results.slice(1);
  
  // Manual RRF implementation with improved balance handling
  const documentScores = new Map<string, { hit: any, rrfScore: number }>();
  
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
  keywordResults.hits.forEach((hit: any, rank: number) => {
    const rrfScore = normalizedKeywordWeight * (1 / (k + rank + 1));
    documentScores.set(hit._id, { hit, rrfScore });
  });
  
  // Process semantic results
  semanticResults.forEach((result: any, modelIndex: number) => {
    result.hits.forEach((hit: any, rank: number) => {
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
      keywordQuery: (keywordResults as any).esQuery,
      semanticQueries: semanticResults.map((r, i) => ({
        model: models[i],
        query: (r as any).esQuery
      }))
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
): Promise<SearchResponse & { esQuery?: any }> {
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
        balance
      );
    } else {
      // Filter to only models we have embeddings for
      const availableModels = modelsArray.filter(m => embeddings[m]);
      
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

    const embedding = artwork._source?.embeddings?.[model];
    if (!embedding) {
      throw new Error(`No ${model} embedding found for artwork ${artworkId}`);
    }

    // Search for similar artworks
    const response = await client.search({
      index: INDEX_NAME,
      body: {
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
      }
    });

    // Filter out the source artwork
    const hits = response.hits.hits.filter((hit: any) => hit._id !== artworkId);

    return {
      took: response.took,
      total: hits.length,
      hits: hits.slice(0, size).map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error(`Similar artworks search error for ${model}:`, error);
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
      indexSize: stats._all.total.store.size_in_bytes,
      indexSizeHuman: formatBytes(stats._all.total.store.size_in_bytes),
      totalDocuments: stats._all.total.docs.count,
    };
  } catch (error) {
    console.error('Error getting index stats:', error);
    return null;
  }
}

// Get a single artwork by ID
export async function getArtworkById(id: string) {
  try {
    const client = getElasticsearchClient();
    const response = await client.get({
      index: INDEX_NAME,
      id,
      _source_excludes: ['embeddings']
    });
    
    return response._source;
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