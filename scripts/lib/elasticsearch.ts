import { Client } from '@elastic/elasticsearch';

// Create a function to get the client so env vars are loaded first
let _esClient: Client | null = null;

export function createElasticsearchClient(): Client {
  if (_esClient) {
    return _esClient;
  }

  const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const API_KEY = process.env.ELASTICSEARCH_API_KEY;
  const CLOUD_ID = process.env.ELASTICSEARCH_CLOUD_ID;

  // Create client with proper authentication
  let clientConfig: any = {};

  if (CLOUD_ID && API_KEY) {
    // Elastic Cloud configuration with Cloud ID
    clientConfig = {
      cloud: {
        id: CLOUD_ID
      },
      auth: {
        apiKey: API_KEY
      }
    };
  } else if (API_KEY && (ES_URL.includes('elastic.co') || ES_URL.includes('elastic-cloud.com'))) {
    // Elastic Cloud with URL
    clientConfig = {
      node: ES_URL,
      auth: {
        apiKey: API_KEY
      }
    };
  } else {
    // Local Elasticsearch
    clientConfig = {
      node: ES_URL
    };
  }

  _esClient = new Client(clientConfig);

  // Log connection details for debugging
  console.log('Elasticsearch script client config:', {
    url: ES_URL,
    hasApiKey: !!API_KEY,
    hasCloudId: !!CLOUD_ID,
    usingCloud: !!API_KEY && (ES_URL.includes('elastic.co') || ES_URL.includes('elastic-cloud.com'))
  });

  return _esClient;
}

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 'artworks_semantic';

// Index mapping for universal artworks with embeddings
export const INDEX_MAPPING = {
  mappings: {
    properties: {
      // Core fields (previously in metadata)
      id: { type: 'keyword' as const },
      title: { type: 'text' as const, analyzer: 'standard' },
      titles: { type: 'text' as const, analyzer: 'standard' },
      artist: { type: 'text' as const, analyzer: 'standard' },
      date: { type: 'text' as const },
      medium: { type: 'text' as const },
      dimensions: { type: 'text' as const },
      creditLine: { type: 'text' as const },
      
      // Collection info
      collection: { type: 'keyword' as const },
      collectionId: { type: 'keyword' as const },
      sourceUrl: { type: 'keyword' as const },
      
      // Additional common fields
      department: { type: 'keyword' as const },
      classification: { type: 'keyword' as const },
      objectName: { type: 'keyword' as const },
      culture: { type: 'keyword' as const },
      period: { type: 'keyword' as const },
      dynasty: { type: 'keyword' as const },
      
      // Geographic origin
      geographyType: { type: 'keyword' as const },
      city: { type: 'keyword' as const },
      state: { type: 'keyword' as const },
      country: { type: 'keyword' as const },
      region: { type: 'keyword' as const },
      locale: { type: 'keyword' as const },
      excavation: { type: 'text' as const },
      
      // Museum-specific fields
      objectNumber: { type: 'keyword' as const },
      accessionYear: { type: 'integer' as const },
      galleryNumber: { type: 'keyword' as const },
      portfolio: { type: 'text' as const },
      rightsAndReproduction: { type: 'text' as const },
      
      // Artists array
      artists: {
        type: 'nested' as const,
        properties: {
          constituentId: { type: 'keyword' as const },
          role: { type: 'keyword' as const },
          prefix: { type: 'keyword' as const },
          displayName: { type: 'text' as const, analyzer: 'standard' },
          displayBio: { type: 'text' as const },
          suffix: { type: 'keyword' as const },
          alphaSort: { type: 'keyword' as const },
          nationality: { type: 'keyword' as const },
          beginDate: { type: 'integer' as const },
          endDate: { type: 'integer' as const },
          gender: { type: 'keyword' as const },
          ulanUrl: { type: 'keyword' as const },
          wikidataUrl: { type: 'keyword' as const }
        }
      },
      
      // DEPRECATED single artist fields (kept for backwards compatibility)
      artistId: { type: 'keyword' as const },
      artistBio: { type: 'text' as const },
      artistNationality: { type: 'keyword' as const },
      artistBeginDate: { type: 'integer' as const },
      artistEndDate: { type: 'integer' as const },
      artistGender: { type: 'keyword' as const },
      
      // Dates
      dateBegin: { type: 'integer' as const },
      dateEnd: { type: 'integer' as const },
      
      // Physical properties
      width: { type: 'float' as const },
      height: { type: 'float' as const },
      depth: { type: 'float' as const },
      diameter: { type: 'float' as const },
      weight: { type: 'float' as const },
      
      // Status flags
      isHighlight: { type: 'boolean' as const },
      isPublicDomain: { type: 'boolean' as const },
      onView: { type: 'boolean' as const },
      
      // Tags
      tags: { type: 'keyword' as const, index: true },
      
      // Flexible additional data
      additionalData: { type: 'object' as const, enabled: false },
      
      // Image stays at root
      image: { 
        type: 'object' as const,
        enabled: false
      },
      
      // Visual descriptions container
      visual_description: {
        properties: {
          alt_text: { 
            type: 'text' as const,
            analyzer: 'standard'
          },
          long_description: { 
            type: 'text' as const,
            analyzer: 'standard'
          },
          emoji_summary: {
            type: 'keyword' as const,  // keyword for exact matching
            index: true  // Enable search on emoji string
          },
          emoji_array: {
            type: 'keyword' as const,  // Array of individual emojis
            index: true
          },
          metadata: {
            type: 'object' as const,
            enabled: false
          }
        }
      },
      
      // Combined text for search
      searchText: {
        type: 'text' as const,
        analyzer: 'standard'
      },
      
      // Embeddings
      embeddings: {
        properties: {
          // Cross-modal embedding models
          siglip2: {
            type: 'dense_vector' as const,
            dims: 768,
            index: true,
            similarity: 'cosine' as const,
          },
          // Enhanced text embeddings
          jina_v3: {
            type: 'dense_vector' as const,
            dims: 768,
            index: true,
            similarity: 'cosine' as const,
          },
        },
      },
      
      // Similar artworks (pre-computed by LLM)
      similar_artworks: {
        type: 'nested' as const,
        properties: {
          id: { type: 'keyword' as const },
          similarity_type: { type: 'keyword' as const },
          confidence: { type: 'float' as const },
          explanation: { type: 'text' as const },
          source: { type: 'keyword' as const }
        }
      },
      
      // Timestamp
      indexed_at: { type: 'date' as const }
    },
  },
} as const;