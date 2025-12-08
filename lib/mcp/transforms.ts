import {
  DetailLevel,
  MCPArtworkResult,
  MCPArtist,
  MCPImage,
  MCPDescription,
  MCPSimilarArtwork,
  MCPSearchHit,
  Artwork,
  ArtworkImage,
  Artist,
} from './types';

// ============================================================================
// Individual Transform Functions
// ============================================================================

/**
 * Transform an Artist to MCP API format
 */
export function transformArtist(artist: Artist): MCPArtist {
  return {
    id: artist.constituentId,
    name: artist.displayName,
    role: artist.role,
    bio: artist.displayBio,
    nationality: artist.nationality,
    birth_year: artist.beginDate,
    death_year: artist.endDate,
  };
}

/**
 * Transform an ArtworkImage to MCP API format
 */
export function transformImage(image: ArtworkImage): MCPImage {
  return {
    url: image.url,
    thumbnail_url: image.thumbnailUrl,
    width: image.width,
    height: image.height,
  };
}

/**
 * Normalize image field (can be string or object)
 */
export function normalizeImage(image: string | ArtworkImage | undefined): ArtworkImage | undefined {
  if (!image) return undefined;
  return typeof image === 'string' ? { url: image } : image;
}

/**
 * Transform visual_description to MCP API format
 */
export function transformDescription(desc: {
  alt_text?: string;
  long_description?: string;
  emoji_summary?: string;
}): MCPDescription {
  return {
    alt_text: desc.alt_text,
    long_description: desc.long_description,
    emoji_summary: desc.emoji_summary,
  };
}

/**
 * Transform similar_artworks to MCP API format
 */
export function transformSimilarArtwork(sa: {
  id: string;
  similarity_type: string;
  confidence: number;
  explanation: string;
}): MCPSimilarArtwork {
  return {
    id: sa.id,
    similarity_type: sa.similarity_type,
    confidence: sa.confidence,
    explanation: sa.explanation,
  };
}

// ============================================================================
// Main Transform Functions
// ============================================================================

/**
 * Transform an Elasticsearch search hit to MCP API format.
 * Used by search and image-search endpoints.
 *
 * @param hit - Elasticsearch search hit
 * @param detail - Detail level (minimal, standard, full)
 * @returns Transformed artwork result
 */
export function transformSearchHit(
  hit: MCPSearchHit,
  detail: DetailLevel = 'standard'
): MCPArtworkResult {
  const source = hit._source;
  const imageData = normalizeImage(source.image);

  // Minimal: always included
  const result: MCPArtworkResult = {
    id: hit._id,
    score: hit._score,
    title: source.title,
    artist: source.artist,
    date: source.date,
  };

  // Standard: add common fields
  if (detail === 'standard' || detail === 'full') {
    if (source.medium) result.medium = source.medium;
    if (source.classification) result.classification = source.classification;
    if (source.department) result.department = source.department;
    if (source.tags && source.tags.length > 0) result.tags = source.tags;
    if (source.culture) result.culture = source.culture;
    if (source.sourceUrl) result.source_url = source.sourceUrl;

    if (imageData?.url) {
      result.image_url = imageData.url;
      if (imageData.thumbnailUrl) result.thumbnail_url = imageData.thumbnailUrl;
    }
  }

  // Full: add all available fields
  if (detail === 'full') {
    addFullDetails(result, source, imageData);
  }

  return result;
}

/**
 * Transform a full Artwork document to MCP API format.
 * Used by artwork detail endpoint. Always returns full detail.
 *
 * @param artwork - Full artwork document
 * @param id - Artwork ID
 * @returns Transformed artwork result with all fields
 */
export function transformArtwork(artwork: Artwork, id: string): MCPArtworkResult {
  const imageData = normalizeImage(artwork.image);

  const result: MCPArtworkResult = {
    id,
    title: artwork.title,
    artist: artwork.artist,
    date: artwork.date,
    medium: artwork.medium,
    dimensions: artwork.dimensions,
    credit_line: artwork.creditLine,
    collection: artwork.collection,
    collection_id: artwork.collectionId,
    source_url: artwork.sourceUrl,
  };

  // Classification
  if (artwork.classification) result.classification = artwork.classification;
  if (artwork.department) result.department = artwork.department;

  // Tags
  if (artwork.tags && artwork.tags.length > 0) result.tags = artwork.tags;

  // Culture
  if (artwork.culture) result.culture = artwork.culture;

  // Image URLs for convenience
  if (imageData?.url) {
    result.image_url = imageData.url;
    if (imageData.thumbnailUrl) result.thumbnail_url = imageData.thumbnailUrl;
  }

  // Add all full-detail fields
  addFullDetails(result, artwork, imageData);

  return result;
}

/**
 * Add full-detail fields to a result object.
 * Shared between transformSearchHit and transformArtwork.
 */
function addFullDetails(
  result: MCPArtworkResult,
  source: Artwork,
  imageData: ArtworkImage | undefined
): void {
  // Alternate titles
  if (source.titles && source.titles.length > 1) {
    result.titles = source.titles;
  }

  // Full artists array
  if (source.artists && source.artists.length > 0) {
    result.artists = source.artists.map(transformArtist);
  }

  // Date range
  if (source.dateBegin) result.date_start = source.dateBegin;
  if (source.dateEnd) result.date_end = source.dateEnd;

  // Physical attributes
  if (source.dimensions) result.dimensions = source.dimensions;
  if (source.objectName) result.object_name = source.objectName;

  // Cultural context
  if (source.period) result.period = source.period;
  if (source.dynasty) result.dynasty = source.dynasty;
  if (source.country) result.country = source.country;
  if (source.region) result.region = source.region;

  // Collection info
  if (source.collection) result.collection = source.collection;
  if (source.collectionId) result.collection_id = source.collectionId;
  if (source.creditLine) result.credit_line = source.creditLine;
  if (source.accessionYear) result.accession_year = source.accessionYear;

  // Status flags
  if (source.isPublicDomain !== undefined) result.is_public_domain = source.isPublicDomain;
  if (source.isHighlight !== undefined) result.is_highlight = source.isHighlight;
  if (source.onView !== undefined) result.on_view = source.onView;
  if (source.galleryNumber) result.gallery_number = source.galleryNumber;

  // Full image object with dimensions
  if (imageData?.url) {
    result.image = transformImage(imageData);
  }

  // AI-generated description
  if (source.visual_description) {
    result.description = transformDescription(source.visual_description);
  }

  // Similar artworks
  if (source.similar_artworks && source.similar_artworks.length > 0) {
    result.similar_artworks = source.similar_artworks.map(transformSimilarArtwork);
  }
}

/**
 * Transform an array of search hits.
 * Convenience function for batch transformations.
 */
export function transformSearchHits(
  hits: MCPSearchHit[],
  detail: DetailLevel = 'standard'
): MCPArtworkResult[] {
  return hits.map(hit => transformSearchHit(hit, detail));
}
