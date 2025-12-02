import { NextRequest, NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/elasticsearch/client';
import { Artwork, ArtworkImage, Artist } from '@/app/types';

// ============================================================================
// MCP Artwork Details Response Types
// ============================================================================

interface MCPArtworkResponse {
  id: string;
  title: string;
  titles?: string[];

  // Artist information
  artist: string;
  artists?: Array<{
    id?: string;
    name: string;
    role?: string;
    bio?: string;
    nationality?: string;
    birth_year?: number;
    death_year?: number;
  }>;

  // Dates
  date: string;
  date_start?: number;
  date_end?: number;

  // Physical attributes
  medium: string;
  dimensions: string;

  // Classification
  classification?: string;
  department?: string;
  object_name?: string;

  // Cultural/geographic context
  culture?: string;
  period?: string;
  dynasty?: string;
  country?: string;
  region?: string;

  // Collection info
  collection: string;
  collection_id: string;
  credit_line: string;
  accession_year?: number;

  // Status
  is_public_domain?: boolean;
  is_highlight?: boolean;
  on_view?: boolean;
  gallery_number?: string;

  // Images
  image?: {
    url: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
  };

  // AI-generated content
  description?: {
    alt_text: string;
    long_description: string;
    emoji_summary: string;
  };

  // Tags/keywords
  tags?: string[];

  // Similar artworks (if pre-computed)
  similar_artworks?: Array<{
    id: string;
    similarity_type: string;
    confidence: number;
    explanation: string;
  }>;

  // Links
  source_url: string;
}

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatArtworkResponse(artwork: Artwork, id: string): MCPArtworkResponse {
  // Handle image field
  const imageData: ArtworkImage | undefined =
    typeof artwork.image === 'string'
      ? { url: artwork.image }
      : artwork.image;

  const response: MCPArtworkResponse = {
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

  // Optional array fields
  if (artwork.titles && artwork.titles.length > 1) {
    response.titles = artwork.titles;
  }

  // Artists array with full metadata
  if (artwork.artists && artwork.artists.length > 0) {
    response.artists = artwork.artists.map((a: Artist) => ({
      id: a.constituentId,
      name: a.displayName,
      role: a.role,
      bio: a.displayBio,
      nationality: a.nationality,
      birth_year: a.beginDate,
      death_year: a.endDate,
    }));
  }

  // Date range
  if (artwork.dateBegin) response.date_start = artwork.dateBegin;
  if (artwork.dateEnd) response.date_end = artwork.dateEnd;

  // Classification
  if (artwork.classification) response.classification = artwork.classification;
  if (artwork.department) response.department = artwork.department;
  if (artwork.objectName) response.object_name = artwork.objectName;

  // Cultural context
  if (artwork.culture) response.culture = artwork.culture;
  if (artwork.period) response.period = artwork.period;
  if (artwork.dynasty) response.dynasty = artwork.dynasty;
  if (artwork.country) response.country = artwork.country;
  if (artwork.region) response.region = artwork.region;

  // Collection info
  if (artwork.accessionYear) response.accession_year = artwork.accessionYear;

  // Status flags
  if (artwork.isPublicDomain !== undefined) response.is_public_domain = artwork.isPublicDomain;
  if (artwork.isHighlight !== undefined) response.is_highlight = artwork.isHighlight;
  if (artwork.onView !== undefined) response.on_view = artwork.onView;
  if (artwork.galleryNumber) response.gallery_number = artwork.galleryNumber;

  // Image
  if (imageData?.url) {
    response.image = {
      url: imageData.url,
      thumbnail_url: imageData.thumbnailUrl,
      width: imageData.width,
      height: imageData.height,
    };
  }

  // AI-generated description
  if (artwork.visual_description) {
    response.description = {
      alt_text: artwork.visual_description.alt_text,
      long_description: artwork.visual_description.long_description,
      emoji_summary: artwork.visual_description.emoji_summary,
    };
  }

  // Tags
  if (artwork.tags && artwork.tags.length > 0) {
    response.tags = artwork.tags;
  }

  // Similar artworks
  if (artwork.similar_artworks && artwork.similar_artworks.length > 0) {
    response.similar_artworks = artwork.similar_artworks.map(sa => ({
      id: sa.id,
      similarity_type: sa.similarity_type,
      confidence: sa.confidence,
      explanation: sa.explanation,
    }));
  }

  return response;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Artwork ID is required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const artwork = await getArtworkById(id);

    if (!artwork) {
      return NextResponse.json(
        { error: `Artwork not found: ${id}` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const response = formatArtworkResponse(artwork, id);

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (error: unknown) {
    console.error('MCP Artwork Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ============================================================================
// CORS Preflight Handler
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}
