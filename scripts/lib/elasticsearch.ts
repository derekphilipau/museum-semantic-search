import { Client } from '@elastic/elasticsearch';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

export const esClient = new Client({
  node: ES_URL,
});

export const INDEX_NAME = 'artworks_v1'; // Generic name for multi-collection use

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
      searchableText: { 
        type: 'text',
        analyzer: 'standard'
      },
      embeddings: {
        properties: {
          // API-based models
          jina_embeddings_v4: {
            type: 'dense_vector',
            dims: 2048,
            index: true,
            similarity: 'cosine',
          },
          google_vertex_multimodal: {
            type: 'dense_vector',
            dims: 1408,
            index: true,
            similarity: 'cosine',
          },
        },
      },
    },
  },
};