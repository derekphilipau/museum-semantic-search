import { Client } from '@elastic/elasticsearch';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

export const esClient = new Client({
  node: ES_URL,
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
          // Text embedding models
          google_gemini_text: {
            type: 'dense_vector',
            dims: 768,
            index: true,
            similarity: 'cosine',
          },
          // Image embedding models
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