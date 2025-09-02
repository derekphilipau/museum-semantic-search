import { NextRequest, NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/elasticsearch/client';

// Cache duration for artwork data (1 hour)
const CACHE_DURATION = 3600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: artworkId } = await params;
    
    // Validate artwork ID
    if (!artworkId) {
      return NextResponse.json(
        { error: 'Invalid artwork ID' },
        { status: 400 }
      );
    }

    // Fetch artwork from Elasticsearch by document ID
    const artwork = await getArtworkById(artworkId);
    
    if (!artwork) {
      return NextResponse.json(
        { error: 'Artwork not found' },
        { status: 404 }
      );
    }
    
    // Return with cache headers
    return NextResponse.json(artwork, {
      headers: {
        'Cache-Control': `public, max-age=${CACHE_DURATION}, s-maxage=${CACHE_DURATION}`,
        'ETag': `"${artworkId}-static"`,
      }
    });

  } catch (error) {
    console.error('Error fetching artwork:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch artwork' },
      { status: 500 }
    );
  }
}