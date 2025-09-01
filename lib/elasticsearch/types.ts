export interface ArtworkMetadata {
  objectId: number;
  title: string;
  artist: string;
  artistBio: string;
  department: string;
  culture: string;
  period: string;
  dateCreated: string;
  dateBegin: number | null;
  dateEnd: number | null;
  medium: string;
  dimensions: string;
  creditLine: string;
  tags: string[];
  isHighlight: boolean;
  hasImage: boolean;
  isPublicDomain: boolean;
}

export interface ArtworkImage {
  url: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
  primaryColor?: string | null;
  brightness?: number | null;
}

export interface Artwork {
  id: string;
  metadata: ArtworkMetadata;
  image: ArtworkImage;
  boostedKeywords: string;
  embeddings: Record<string, number[]>;
  visual_alt_text?: string;
  visual_long_description?: string;
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