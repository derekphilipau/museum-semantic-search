import { NextRequest, NextResponse } from 'next/server';
import {
  getArtworkById,
  findSimilarArtworks,
  findMetadataSimilarArtworks,
  findCombinedSimilarArtworks,
  hydrateSimilarArtworks,
} from '@/lib/elasticsearch/client';
import { ModelKey } from '@/lib/embeddings';
import { ArtworkImage, SearchHit } from '@/app/types';

// ============================================================================
// MCP Similar Artworks Request/Response Types
// ============================================================================

interface MCPSimilarRequest {
  /** Search method: 'precomputed' | 'embedding' | 'metadata' | 'combined' (default: 'precomputed') */
  method?: 'precomputed' | 'embedding' | 'metadata' | 'combined';

  /** Embedding model to use for 'embedding' method (default: 'jina_clip') */
  model?: 'jina_text' | 'jina_clip';

  /** Number of results to return (default: 10, max: 50) */
  limit?: number;

  /** Include image URLs in results (default: true) */
  includeImage?: boolean;
}

interface MCPSimilarResult {
  id: string;
  score: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  classification?: string;
  image_url?: string;
  thumbnail_url?: string;
  // Similarity explanation (when available)
  similarity_type?: string;
  similarity_explanation?: string;
  // Sources that contributed to this match (for combined search)
  sources?: string[];
}

interface MCPSimilarResponse {
  meta: {
    source_artwork: {
      id: string;
      title: string;
      artist: string;
    };
    method: string;
    model?: string;
    total: number;
    returned: number;
    processing_time_ms: number;
  };
  results: MCPSimilarResult[];
}

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatSimilarResult(
  hit: SearchHit,
  includeImage: boolean
): MCPSimilarResult {
  const source = hit._source;
  const imageData: ArtworkImage | undefined =
    typeof source.image === 'string'
      ? { url: source.image }
      : source.image;

  const result: MCPSimilarResult = {
    id: hit._id,
    score: hit._score,
    title: source.title,
    artist: source.artist,
    date: source.date,
    medium: source.medium,
  };

  if (source.classification) result.classification = source.classification;

  if (includeImage && imageData?.url) {
    result.image_url = imageData.url;
    if (imageData.thumbnailUrl) result.thumbnail_url = imageData.thumbnailUrl;
  }

  // Add similarity info if available (from precomputed or hydrated results)
  const similarityInfo = (source as { _similarityInfo?: { similarity_type: string; explanation: string } })._similarityInfo;
  if (similarityInfo) {
    result.similarity_type = similarityInfo.similarity_type;
    result.similarity_explanation = similarityInfo.explanation;
  }

  // Add sources if available (from combined search)
  const metadata = (hit as { _metadata?: { sources: string[] } })._metadata;
  if (metadata?.sources) {
    result.sources = metadata.sources;
  }

  return result;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // GET with query params for simple requests
  const { searchParams } = new URL(request.url);
  const body: MCPSimilarRequest = {
    method: (searchParams.get('method') as MCPSimilarRequest['method']) || 'precomputed',
    model: (searchParams.get('model') as MCPSimilarRequest['model']) || 'jina_clip',
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 10,
    includeImage: searchParams.get('includeImage') !== 'false',
  };

  return handleSimilarRequest(await params, body);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // POST with JSON body for more complex requests
  let body: MCPSimilarRequest = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine, use defaults
  }

  return handleSimilarRequest(await params, body);
}

async function handleSimilarRequest(
  params: { id: string },
  body: MCPSimilarRequest
) {
  const startTime = Date.now();

  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { error: 'Artwork ID is required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const {
      method = 'precomputed',
      model = 'jina_clip',
      limit = 10,
      includeImage = true,
    } = body;

    // Clamp limit
    const size = Math.min(Math.max(1, limit), 50);

    // Get source artwork for metadata
    const sourceArtwork = await getArtworkById(id);
    if (!sourceArtwork) {
      return NextResponse.json(
        { error: `Artwork not found: ${id}` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    let hits: SearchHit[] = [];
    let methodUsed = method;
    let modelUsed: string | undefined;

    switch (method) {
      case 'precomputed':
        // Use pre-computed similar artworks from LLM curation
        if (sourceArtwork.similar_artworks && sourceArtwork.similar_artworks.length > 0) {
          const limitedSimilar = sourceArtwork.similar_artworks.slice(0, size);
          hits = await hydrateSimilarArtworks(limitedSimilar);
        } else {
          // Fall back to embedding-based search if no precomputed results
          const fallbackResult = await findSimilarArtworks(id, 'jina_clip', size);
          hits = fallbackResult.hits;
          methodUsed = 'embedding';
          modelUsed = 'jina_clip';
        }
        break;

      case 'embedding':
        // Use embedding-based KNN search
        modelUsed = model;
        const embeddingResult = await findSimilarArtworks(id, model as ModelKey, size);
        hits = embeddingResult.hits;
        break;

      case 'metadata':
        // Use metadata-based similarity
        const metadataResult = await findMetadataSimilarArtworks(id, size);
        hits = metadataResult.hits;
        break;

      case 'combined':
        // Use combined approach with multiple signals
        modelUsed = 'jina_text + jina_clip + metadata';
        const combinedResult = await findCombinedSimilarArtworks(
          id,
          ['jina_text', 'jina_clip'],
          size
        );
        hits = combinedResult.hits;
        break;

      default:
        return NextResponse.json(
          { error: `Invalid method: ${method}. Use: precomputed, embedding, metadata, or combined` },
          { status: 400, headers: CORS_HEADERS }
        );
    }

    const response: MCPSimilarResponse = {
      meta: {
        source_artwork: {
          id,
          title: sourceArtwork.title,
          artist: sourceArtwork.artist,
        },
        method: methodUsed,
        model: modelUsed,
        total: hits.length,
        returned: hits.length,
        processing_time_ms: Date.now() - startTime,
      },
      results: hits.map(hit => formatSimilarResult(hit, includeImage)),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (error: unknown) {
    console.error('MCP Similar Error:', error);

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
