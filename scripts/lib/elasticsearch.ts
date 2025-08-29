import { Client } from '@elastic/elasticsearch';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

export const esClient = new Client({
  node: ES_URL,
});

export const INDEX_NAME = 'met_artworks_v2';

// Index mapping for artworks with embeddings
export const INDEX_MAPPING = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      metadata: {
        properties: {
          objectId: { type: 'integer' },
          title: { type: 'text' },
          artist: { type: 'text' },
          artistBio: { type: 'text' },
          department: { type: 'keyword' },
          culture: { type: 'keyword' },
          period: { type: 'text' },
          dateCreated: { type: 'keyword' },
          dateBegin: { type: 'integer' },
          dateEnd: { type: 'integer' },
          medium: { type: 'text' },
          dimensions: { type: 'text' },
          creditLine: { type: 'text' },
          tags: { type: 'keyword' },
          isHighlight: { type: 'boolean' },
          hasImage: { type: 'boolean' },
          isPublicDomain: { type: 'boolean' },
        },
      },
      image: { type: 'keyword' },
      searchableText: { type: 'text' },
      boostedKeywords: { type: 'text' },
      embeddings: {
        properties: {
          // API-based models
          jina_clip_v2: {
            type: 'dense_vector',
            dims: 1024,
            index: true,
            similarity: 'cosine',
          },
          voyage_multimodal_3: {
            type: 'dense_vector',
            dims: 1024,
            index: true,
            similarity: 'cosine',
          },
          cohere_embed_4_v2: {
            type: 'dense_vector',
            dims: 1024,
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