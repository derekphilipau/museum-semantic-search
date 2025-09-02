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
      id: { type: 'keyword' },
      metadata: {
        properties: {
          // Core fields
          id: { type: 'keyword' },
          title: { type: 'text', analyzer: 'standard' },
          artist: { type: 'text', analyzer: 'standard' },
          date: { type: 'text' },
          medium: { type: 'text' },
          dimensions: { type: 'text' },
          creditLine: { type: 'text' },
          
          // Collection info
          collection: { type: 'keyword' },
          collectionId: { type: 'keyword' },
          sourceUrl: { type: 'keyword' },
          
          // Additional common fields
          department: { type: 'keyword' },
          classification: { type: 'keyword' },
          culture: { type: 'keyword' },
          period: { type: 'keyword' },
          dynasty: { type: 'keyword' },
          
          // Artist info
          artistBio: { type: 'text' },
          artistNationality: { type: 'keyword' },
          artistBeginDate: { type: 'integer' },
          artistEndDate: { type: 'integer' },
          artistGender: { type: 'keyword' },
          
          // Dates
          dateBegin: { type: 'integer' },
          dateEnd: { type: 'integer' },
          
          // Physical properties
          width: { type: 'float' },
          height: { type: 'float' },
          depth: { type: 'float' },
          diameter: { type: 'float' },
          weight: { type: 'float' },
          
          // Status flags
          isHighlight: { type: 'boolean' },
          isPublicDomain: { type: 'boolean' },
          onView: { type: 'boolean' },
          
          // Flexible additional data
          additionalData: { type: 'object', enabled: false }
        },
      },
      image: { 
        type: 'object',
        enabled: false
      },
      // Visual descriptions
      visual_alt_text: { 
        type: 'text',
        analyzer: 'standard'
      },
      visual_long_description: { 
        type: 'text',
        analyzer: 'standard'
      },
      description_metadata: {
        type: 'object',
        enabled: false
      },
      embeddings: {
        properties: {
          // Cross-modal embedding models
          siglip2: {
            type: 'dense_vector',
            dims: 768,
            index: true,
            similarity: 'cosine',
          },
          // Enhanced text embeddings
          jina_v3: {
            type: 'dense_vector',
            dims: 768,
            index: true,
            similarity: 'cosine',
          },
        },
      },
    },
  },
};