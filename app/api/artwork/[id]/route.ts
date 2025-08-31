import { NextRequest, NextResponse } from 'next/server';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

// Cache duration for artwork data (1 hour)
const CACHE_DURATION = 3600;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const artworkId = params.id;
    
    // Validate artwork ID
    if (!artworkId) {
      return NextResponse.json(
        { error: 'Invalid artwork ID' },
        { status: 400 }
      );
    }

    // Fetch artwork from Elasticsearch by document ID
    const response = await fetch(`${ES_URL}/${INDEX_NAME}/_doc/${artworkId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch artwork');
    }

    const result = await response.json();
    
    if (!result.found) {
      return NextResponse.json(
        { error: 'Artwork not found' },
        { status: 404 }
      );
    }

    const artwork = result._source;
    
    // Return with cache headers
    return NextResponse.json(artwork, {
      headers: {
        'Cache-Control': `public, max-age=${CACHE_DURATION}, s-maxage=${CACHE_DURATION}`,
        'ETag': `"${artworkId}-${artwork.metadata?.lastUpdate || 'static'}"`,
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