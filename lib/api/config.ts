// Shared configuration for API routes
export const ES_CONFIG = {
  url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  index: process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic', // Generic index for all collections
  defaultSize: 10,
  maxCandidates: 50,
} as const;

// API validation constants
export const VALIDATION = {
  maxTextLength: 10000,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxResults: 100,
  minResults: 1,
  defaultResults: 10,
} as const;

// Cache configuration
export const CACHE_CONFIG = {
  artworkDuration: 3600, // 1 hour
  searchDuration: 300, // 5 minutes
} as const;