import { NextRequest, NextResponse } from 'next/server';
import { embedJinaClipImage } from '@/lib/embeddings';
import { performSemanticSearchWithEmbedding, SearchFilters } from '@/lib/elasticsearch/client';
import { ArtworkImage } from '@/app/types';

// ============================================================================
// MCP Image Search Request/Response Types
// ============================================================================

interface MCPImageSearchRequest {
  /** Base64-encoded image data (with or without data URL prefix) */
  image: string;

  /** Optional MIME type (auto-detected from data URL if not provided) */
  mimeType?: string;

  /** Optional structured filters */
  filters?: {
    artistName?: string;
    yearStart?: number;
    yearEnd?: number;
    classification?: string;
    department?: string;
    tags?: string[];
    culture?: string;
    onView?: boolean;
    isPublicDomain?: boolean;
  };

  /** Number of results to return (default: 10, max: 50) */
  limit?: number;

  /** Include image URLs in results (default: true) */
  includeImage?: boolean;
}

interface MCPImageSearchResult {
  id: string;
  score: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  classification?: string;
  department?: string;
  image_url?: string;
  thumbnail_url?: string;
  tags?: string[];
  culture?: string;
  source_url?: string;
}

interface MCPImageSearchResponse {
  meta: {
    method: 'image_embedding';
    model: 'jina_clip';
    total: number;
    returned: number;
    filters_applied: Record<string, string | number | boolean | string[]>;
    processing_time_ms: number;
    embedding_time_ms: number;
  };
  results: MCPImageSearchResult[];
}

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: MCPImageSearchRequest = await request.json();
    const {
      image,
      mimeType: providedMimeType,
      filters = {},
      limit = 10,
      includeImage = true,
    } = body;

    // Validate image
    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'image is required and must be a base64-encoded string' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Clamp limit
    const size = Math.min(Math.max(1, limit), 50);

    // Parse image data
    let base64Data: string;
    let mimeType: string;

    if (image.startsWith('data:')) {
      // Data URL format: data:image/jpeg;base64,/9j/4AAQ...
      const [prefix, payload] = image.split(',');
      const mimeMatch = prefix?.match(/^data:(.*?);base64$/);
      mimeType = mimeMatch?.[1] || providedMimeType || 'image/jpeg';
      base64Data = payload || '';
    } else {
      // Raw base64
      base64Data = image;
      mimeType = providedMimeType || 'image/jpeg';
    }

    if (!base64Data) {
      return NextResponse.json(
        { error: 'Invalid image data' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Build search filters
    const searchFilters: SearchFilters = {};
    if (filters.artistName) searchFilters.artistName = filters.artistName;
    if (filters.yearStart !== undefined) searchFilters.yearStart = filters.yearStart;
    if (filters.yearEnd !== undefined) searchFilters.yearEnd = filters.yearEnd;
    if (filters.classification) searchFilters.classification = filters.classification;
    if (filters.department) searchFilters.department = filters.department;
    if (filters.tags && filters.tags.length > 0) searchFilters.tags = filters.tags;
    if (filters.culture) searchFilters.culture = filters.culture;
    if (filters.onView !== undefined) searchFilters.onView = filters.onView;
    if (filters.isPublicDomain !== undefined) searchFilters.isPublicDomain = filters.isPublicDomain;

    // Build filters_applied for response
    const filtersApplied: Record<string, string | number | boolean | string[]> = {};
    Object.entries(searchFilters).forEach(([key, value]) => {
      if (value !== undefined) {
        filtersApplied[key] = value as string | number | boolean | string[];
      }
    });

    // Generate image embedding
    const embedStart = Date.now();
    const embeddingVector = await embedJinaClipImage(base64Data, mimeType);
    const embeddingTime = Date.now() - embedStart;

    // Perform semantic search
    const hasFilters = Object.keys(searchFilters).length > 0;
    const searchResults = await performSemanticSearchWithEmbedding(
      embeddingVector.values,
      'jina_clip',
      size,
      hasFilters ? searchFilters : undefined
    );

    // Build response
    const response: MCPImageSearchResponse = {
      meta: {
        method: 'image_embedding',
        model: 'jina_clip',
        total: searchResults.total,
        returned: searchResults.hits.length,
        filters_applied: filtersApplied,
        processing_time_ms: Date.now() - startTime,
        embedding_time_ms: embeddingTime,
      },
      results: searchResults.hits.map(hit => {
        const source = hit._source;
        const imageData: ArtworkImage | undefined =
          typeof source.image === 'string'
            ? { url: source.image }
            : source.image;

        const result: MCPImageSearchResult = {
          id: hit._id,
          score: hit._score,
          title: source.title,
          artist: source.artist,
          date: source.date,
          medium: source.medium,
        };

        if (source.classification) result.classification = source.classification;
        if (source.department) result.department = source.department;

        if (includeImage && imageData?.url) {
          result.image_url = imageData.url;
          if (imageData.thumbnailUrl) result.thumbnail_url = imageData.thumbnailUrl;
        }

        if (source.tags && source.tags.length > 0) {
          result.tags = source.tags;
        }

        if (source.culture) result.culture = source.culture;
        if (source.sourceUrl) result.source_url = source.sourceUrl;

        return result;
      }),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (error: unknown) {
    console.error('MCP Image Search Error:', error);

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
