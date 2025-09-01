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
  additionalData?: Record<string, any>;
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

export interface SearchMetadata {
  indexName?: string;
  indexSize: number;
  indexSizeHuman: string;
  totalDocuments: number;
  timestamp: string;
  totalQueryTime?: number;
  esQueries?: {
    keyword?: any;
    semantic?: Record<string, any>;
    hybrid?: any;
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