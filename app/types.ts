// Generic artwork metadata that can work across different collections
export interface ArtworkMetadata {
  // Core fields that most collections have
  id: string;                    // Unique ID within the collection
  title: string;
  artist: string;                // Primary artist/creator
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
  culture?: string;              // Cultural context (mainly for historical works)
  period?: string;               // Art historical period
  dynasty?: string;              // For Asian art
  
  // Artist information
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

export interface Artwork {
  id: string;                    // Elasticsearch document ID
  metadata: ArtworkMetadata;
  image: ArtworkImage | string;  // Can be object or simple URL string
  embeddings: Record<string, number[]>;  // Model name -> embedding vector
  visual_alt_text?: string;      // AI-generated alt text
  visual_long_description?: string; // AI-generated detailed description
  visual_emoji_summary?: string; // AI-generated emoji summary (2-8 emojis)
  description_metadata?: {
    model: string;
    generated_at: string;
    has_violations: boolean;
    violations: string[];
  };
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