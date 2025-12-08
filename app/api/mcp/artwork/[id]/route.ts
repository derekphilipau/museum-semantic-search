import { NextRequest, NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/elasticsearch/client';
import {
  MCPArtworkResult,
  transformArtwork,
  CORS_HEADERS_GET,
} from '@/lib/mcp';

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
        { status: 400, headers: CORS_HEADERS_GET }
      );
    }

    const artwork = await getArtworkById(id);

    if (!artwork) {
      return NextResponse.json(
        { error: `Artwork not found: ${id}` },
        { status: 404, headers: CORS_HEADERS_GET }
      );
    }

    // Transform using shared function
    const response: MCPArtworkResult = transformArtwork(artwork, id);

    return NextResponse.json(response, { headers: CORS_HEADERS_GET });
  } catch (error: unknown) {
    console.error('MCP Artwork Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS_GET }
    );
  }
}

// ============================================================================
// CORS Preflight Handler
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS_GET,
  });
}
