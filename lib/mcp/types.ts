import { Artwork, ArtworkImage, Artist } from '@/app/types';

// ============================================================================
// Detail Levels
// ============================================================================

export type DetailLevel = 'minimal' | 'standard' | 'full';

// ============================================================================
// Transformed Types (API Response Format)
// ============================================================================

export interface MCPArtist {
  id?: string;
  name: string;
  role?: string;
  bio?: string;
  nationality?: string;
  birth_year?: number;
  death_year?: number;
}

export interface MCPImage {
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
}

export interface MCPDescription {
  alt_text?: string;
  long_description?: string;
  emoji_summary?: string;
}

export interface MCPSimilarArtwork {
  id: string;
  similarity_type: string;
  confidence: number;
  explanation: string;
}

/**
 * Unified artwork result type for all MCP endpoints.
 * Fields are progressively included based on detail level:
 * - minimal: id, score, title, artist, date
 * - standard: + medium, classification, department, tags, culture, image_url, thumbnail_url, source_url
 * - full: + all remaining fields
 */
export interface MCPArtworkResult {
  // Always included (minimal+)
  id: string;
  score?: number; // Only present in search results
  title: string;
  artist: string;
  date: string;

  // Standard detail level
  medium?: string;
  classification?: string;
  department?: string;
  image_url?: string;
  thumbnail_url?: string;
  tags?: string[];
  culture?: string;
  source_url?: string;

  // Full detail level
  titles?: string[];
  artists?: MCPArtist[];
  date_start?: number;
  date_end?: number;
  dimensions?: string;
  object_name?: string;
  period?: string;
  dynasty?: string;
  country?: string;
  region?: string;
  collection?: string;
  collection_id?: string;
  credit_line?: string;
  accession_year?: number;
  is_public_domain?: boolean;
  is_highlight?: boolean;
  on_view?: boolean;
  gallery_number?: string;
  image?: MCPImage;
  description?: MCPDescription;
  similar_artworks?: MCPSimilarArtwork[];
}

// ============================================================================
// Filter Types
// ============================================================================

export interface MCPFilters {
  artistName?: string;
  yearStart?: number;
  yearEnd?: number;
  medium?: string;
  classification?: string;
  department?: string;
  tags?: string[];
  culture?: string;
  country?: string;
  onView?: boolean;
  isPublicDomain?: boolean;
}

// ============================================================================
// Search Hit Type (from Elasticsearch)
// ============================================================================

export interface MCPSearchHit {
  _id: string;
  _score: number;
  _source: Artwork;
}

// Re-export types that are commonly needed alongside MCP types
export type { Artwork, ArtworkImage, Artist };
