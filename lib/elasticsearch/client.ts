import { Client } from '@elastic/elasticsearch';
import { generateEmbedding } from '@/lib/embeddings';
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
  size: number = 10,
  includeDescriptions: boolean = false
): Promise<SearchResponse> {
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
    
    const response = await client.search({
      index: INDEX_NAME,
      body: {
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
      }
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error('Keyword search error:', error);
    return { took: 0, total: 0, hits: [] };
  }
}

export async function performSemanticSearch(
  query: string,
  model: ModelKey,
  size: number = 10
): Promise<SearchResponse> {
  try {
    const client = getElasticsearchClient();
    
    const embeddingResult = await generateEmbedding(query, model);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding');
    }

    const response = await client.search({
      index: INDEX_NAME,
      body: {
        size,
        _source: {
          excludes: ['embeddings']
        },
        knn: {
          field: `embeddings.${model}`,
          query_vector: embeddingResult.embedding,
          k: size,
          num_candidates: size * 2
        }
      }
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error(`Semantic search error for ${model}:`, error);
    return { took: 0, total: 0, hits: [] };
  }
}

export async function performHybridSearch(
  query: string,
  model: ModelKey,
  size: number = 10,
  includeDescriptions: boolean = false
): Promise<SearchResponse> {
  try {
    const client = getElasticsearchClient();
    
    const embeddingResult = await generateEmbedding(query, model);
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding');
    }

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

    const response = await client.search({
      index: INDEX_NAME,
      body: {
        size,
        _source: {
          excludes: ['embeddings']
        },
        knn: {
          field: `embeddings.${model}`,
          query_vector: embeddingResult.embedding,
          k: size,
          num_candidates: size * 2
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
      }
    });

    return {
      took: response.took,
      total: response.hits.total.value,
      hits: response.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _score: hit._score,
        _source: hit._source
      }))
    };
  } catch (error) {
    console.error(`Hybrid search error for ${model}:`, error);
    return { took: 0, total: 0, hits: [] };
  }
}

// Similar artworks search using KNN
export async function findSimilarArtworks(
  artworkId: string,
  model: ModelKey,
  size: number = 10
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