import { Client } from '@elastic/elasticsearch';

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

export const esClient = new Client(clientConfig);

// Log connection details for debugging
console.log('Elasticsearch script client config:', {
  url: ES_URL,
  hasApiKey: !!API_KEY,
  hasCloudId: !!CLOUD_ID,
  usingCloud: !!API_KEY && (ES_URL.includes('elastic.co') || ES_URL.includes('elastic-cloud.com'))
});

export const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

// Index mapping for artworks with embeddings
export const INDEX_MAPPING = {
  mappings: {
    properties: {
      id: { type: 'keyword' as const },
      metadata: {
        properties: {
          // Core fields
          id: { type: 'keyword' as const },
          title: { type: 'text' as const, analyzer: 'standard' },
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
          culture: { type: 'keyword' as const },
          period: { type: 'keyword' as const },
          dynasty: { type: 'keyword' as const },
          
          // Artist info
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
          
          // Flexible additional data
          additionalData: { type: 'object' as const, enabled: false }
        },
      },
      image: { 
        type: 'object' as const,
        enabled: false
      },
      // Visual descriptions
      visual_alt_text: { 
        type: 'text' as const,
        analyzer: 'standard'
      },
      visual_long_description: { 
        type: 'text' as const,
        analyzer: 'standard'
      },
      description_metadata: {
        type: 'object' as const,
        enabled: false
      },
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
    },
  },
} as const;