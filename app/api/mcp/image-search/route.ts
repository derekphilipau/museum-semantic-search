import { NextRequest, NextResponse } from 'next/server';
import { embedJinaClipImage } from '@/lib/embeddings';
import { performSemanticSearchWithEmbedding } from '@/lib/elasticsearch/client';
import {
  DetailLevel,
  MCPFilters,
  MCPArtworkResult,
  MCPSearchHit,
  transformSearchHits,
  convertFilters,
  buildFiltersApplied,
  CORS_HEADERS_POST,
} from '@/lib/mcp';

// ============================================================================
// MCP Image Search Request/Response Types
// ============================================================================

interface MCPImageSearchRequest {
  image: string;
  mimeType?: string;
  filters?: MCPFilters;
  limit?: number;
  detail?: DetailLevel;
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
  results: MCPArtworkResult[];
}

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
      detail = 'standard',
    } = body;

    // Validate image
    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'image is required and must be a base64-encoded string' },
        { status: 400, headers: CORS_HEADERS_POST }
      );
    }

    // Clamp limit
    const size = Math.min(Math.max(1, limit), 50);

    // Parse image data
    let base64Data: string;
    let mimeType: string;

    if (image.startsWith('data:')) {
      const [prefix, payload] = image.split(',');
      const mimeMatch = prefix?.match(/^data:(.*?);base64$/);
      mimeType = mimeMatch?.[1] || providedMimeType || 'image/jpeg';
      base64Data = payload || '';
    } else {
      base64Data = image;
      mimeType = providedMimeType || 'image/jpeg';
    }

    if (!base64Data) {
      return NextResponse.json(
        { error: 'Invalid image data' },
        { status: 400, headers: CORS_HEADERS_POST }
      );
    }

    // Convert filters
    const searchFilters = convertFilters(filters);
    const filtersApplied = buildFiltersApplied(searchFilters);

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

    // Transform results using shared function
    const results = transformSearchHits(searchResults.hits as MCPSearchHit[], detail);

    const response: MCPImageSearchResponse = {
      meta: {
        method: 'image_embedding',
        model: 'jina_clip',
        total: searchResults.total,
        returned: results.length,
        filters_applied: filtersApplied,
        processing_time_ms: Date.now() - startTime,
        embedding_time_ms: embeddingTime,
      },
      results,
    };

    return NextResponse.json(response, { headers: CORS_HEADERS_POST });
  } catch (error: unknown) {
    console.error('MCP Image Search Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS_POST }
    );
  }
}

// ============================================================================
// CORS Preflight Handler
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS_POST,
  });
}
