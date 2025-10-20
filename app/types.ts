// Artist information
export interface Artist {
  constituentId?: string;        // Unique artist ID
  role?: string;                 // e.g., "Artist", "After", "In the manner of"
  prefix?: string;               // e.g., "After", "Attributed to"
  displayName: string;           // Full display name
  displayBio?: string;           // Biographical info
  suffix?: string;               // Name suffix
  alphaSort?: string;            // Name for alphabetical sorting
  nationality?: string;          // Artist nationality
  beginDate?: number;            // Birth/start year
  endDate?: number;              // Death/end year
  gender?: string;               // Artist gender
  ulanUrl?: string;              // Getty ULAN URL
  wikidataUrl?: string;          // Wikidata URL
}

// Generic artwork metadata that can work across different collections
export interface ArtworkMetadata {
  // Core fields that most collections have
  id: string;                    // Unique ID within the collection
  title: string;                 // Primary title (first in array if multiple)
  titles?: string[];             // All titles (multiple languages, alternate titles)
  artist: string;                // Primary artist/creator display string
  artists?: Artist[];            // Array of all artists with full metadata
  date: string;                  // Display date (e.g., "1889", "ca. 1900", "1950-1960")
  medium: string;                // Materials/technique
  dimensions: string;            // Physical dimensions as string
  creditLine: string;            // How the work was acquired
  
  // Collection-specific identifier
  collection: string;            // "moma", "met", "rijksmuseum", etc.
  collectionId: string;          // Original ID from source collection
  sourceUrl: string;             // Link to artwork on museum website
  
  // Additional common fields (optional)
  department?: string;           // Museum department
  classification?: string;       // Type of artwork (painting, sculpture, etc.)
  objectName?: string;           // Specific object type (e.g., "Coin", "Vase", "Portrait")
  culture?: string;              // Cultural context (mainly for historical works)
  period?: string;               // Art historical period
  dynasty?: string;              // For Asian art
  
  // Geographic origin
  geographyType?: string;        // Type of geography (e.g., "Made in", "From")
  city?: string;                 // City of origin
  state?: string;                // State/province of origin
  country?: string;              // Country of origin
  region?: string;               // Broader region (e.g., "Europe", "East Asia")
  locale?: string;               // Specific locale
  excavation?: string;           // Archaeological excavation site
  
  // Museum-specific
  objectNumber?: string;         // Museum's catalog number
  accessionYear?: number;        // Year acquired by museum
  galleryNumber?: string;        // Current gallery location
  portfolio?: string;            // Part of a portfolio/series
  rightsAndReproduction?: string; // Copyright and usage rights
  
  // DEPRECATED: Single artist fields kept for backwards compatibility
  // Use artists[] array instead
  artistId?: string;             // Artist identifier (e.g., Constituent ID)
  artistBio?: string;            // Artist biographical info
  artistNationality?: string;    // Artist nationality
  artistBeginDate?: number;      // Artist birth year
  artistEndDate?: number;        // Artist death year
  artistGender?: string;         // Artist gender
  
  // Dates
  dateBegin?: number;            // Earliest year (for date ranges)
  dateEnd?: number;              // Latest year (for date ranges)
  
  // Physical properties
  width?: number;                // Width in cm
  height?: number;               // Height in cm  
  depth?: number;                // Depth in cm
  diameter?: number;             // Diameter in cm
  weight?: number;               // Weight in kg
  
  // Status flags
  isHighlight?: boolean;         // Featured/important work
  isPublicDomain?: boolean;      // Copyright status
  onView?: boolean;              // Currently on display
  
  // Tags/keywords
  tags?: string[];               // Tags/keywords for the artwork
  
  // Additional metadata as key-value pairs for flexibility
  additionalData?: Record<string, string | number | boolean | null>;
}

export interface ArtworkImage {
  url: string;                   // Primary image URL
  thumbnailUrl?: string;         // Thumbnail URL if available
  iiifUrl?: string;              // IIIF image server URL if available
  width?: number;                // Image width in pixels
  height?: number;               // Image height in pixels
  primaryColor?: string | null;  // Dominant color
  brightness?: number | null;    // Average brightness
  copyright?: string;            // Image rights information
}

// Visual description object for AI-generated content
export interface VisualDescription {
  alt_text: string;              // AI-generated alt text
  long_description: string;      // AI-generated detailed description
  emoji_summary: string;         // AI-generated emoji summary (2-8 emojis)
  emoji_array: string[];         // Individual emojis as array
  metadata: {
    model: string;
    generated_at: string;
    edited_model?: string;
    edited_at?: string;
    changes_made?: string[];
  };
}

// Similar artwork found by LLM curation
export interface SimilarArtwork {
  id: string;                    // Artwork ID
  similarity_type: string;       // style, subject, mood, technique, period, multiple
  confidence: number;            // 0-1 confidence score
  explanation: string;           // Human-readable explanation
  source: string;                // metadata, jina_text, jina_clip
}

// Flattened artwork structure for Elasticsearch
export interface Artwork extends ArtworkMetadata {
  // image stays at root level
  image: ArtworkImage | string;  // Can be object or simple URL string
  
  // Embeddings for different models
  embeddings: Record<string, number[]>;  // Model name -> embedding vector
  
  // Visual descriptions container
  visual_description?: VisualDescription;
  
  // Combined text for search
  searchText?: string;
  
  // Pre-computed similar artworks from LLM curation
  similar_artworks?: SimilarArtwork[];
  
  // Indexing timestamp
  indexed_at?: string;
}

export interface SearchHit {
  _id: string;
  _score: number;
  _source: Artwork;
}

export interface SearchResponse {
  took: number;
  total: number;
  hits: SearchHit[];
}

// Extended search response that includes the ES query for debugging
export interface SearchResponseWithQuery extends SearchResponse {
  esQuery?: ESSearchQuery | ESHybridQuery;
}

// Elasticsearch query types
export interface ESMultiMatchQuery {
  multi_match: {
    query: string;
    fields: string[];
    type: string;
    fuzziness?: string;
  };
}

export interface ESKnnQuery {
  field: string;
  query_vector: number[] | string;
  k: number;
  num_candidates: number;
}

export interface ESSearchQuery {
  size: number;
  _source?: {
    excludes?: string[];
  };
  query?: {
    bool?: {
      must?: Array<ESMultiMatchQuery | Record<string, unknown>>;
      should?: Array<Record<string, unknown>>;
      must_not?: Array<Record<string, unknown>>;
      minimum_should_match?: number;
    };
  };
  knn?: ESKnnQuery;
}

export interface ESHybridQuery {
  note: string;
  balance: number;
  k: number;
  weights: {
    keyword: {
      raw: number;
      normalized: number;
    };
    semantic: {
      raw: number;
      normalized: number;
      perModel?: number;
    };
  };
  model?: string;
  models?: string[];
  keywordQuery?: ESSearchQuery;
  semanticQuery?: ESSearchQuery;
  semanticQueries?: Array<{
    model: string;
    query: ESSearchQuery;
  }>;
}

export interface SearchMetadata {
  indexName?: string;
  indexSize?: number;
  indexSizeHuman?: string;
  totalDocuments?: number;
  timestamp: string;
  totalQueryTime?: number;
  esQueries?: {
    keyword?: ESSearchQuery;
    semantic?: Record<string, ESSearchQuery>;
    hybrid?: ESHybridQuery;
  };
  cache?: {
    hit: boolean;
    query?: string;
    embeddingsUsed?: 'cached' | 'generated';
  };
}

export interface MultiSearchResponse {
  query: string;
  models: string[];
  mode: string;
  results: Record<string, SearchResponse>;
  timestamp: string;
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

// UMAP Projection types
export interface ProjectionPoint {
  artwork_id: string;
  embedding_type: string;
  projection_type: string;
  coordinates: [number, number] | [number, number, number];
  metadata: {
    title: string;
    artist: string;
    date: string;
    medium: string;
    department?: string;
    tags: string[];
    image: ArtworkImage | string;  // Use consistent image structure
    alt_text: string;
  };
  timestamp: string;
  // Optional normalized coordinates for rendering
  normalizedCoords?: [number, number];
}

export type ProjectionType = 'standard_2d' | 'tight_2d' | 'loose_2d' | 'standard_3d';
export type EmbeddingType = 'jina_text' | 'jina_clip';
export type ColorByOption = 'artist' | 'period' | 'tags' | 'department';
export type DisplayMode = 'points' | 'thumbnails';
