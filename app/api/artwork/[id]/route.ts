import { NextRequest, NextResponse } from 'next/server';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'artworks_v1';

// Cache duration for artwork data (1 hour)
const CACHE_DURATION = 3600;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const objectId = parseInt(params.id);
    
    // Validate objectId
    if (isNaN(objectId) || objectId <= 0) {
      return NextResponse.json(
        { error: 'Invalid object ID. Must be a positive integer.' },
        { status: 400 }
      );
    }

    // Fetch artwork from Elasticsearch
    const response = await fetch(`${ES_URL}/${INDEX_NAME}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          term: {
            'metadata.objectId': objectId
          }
        },
        size: 1
      })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch artwork');
    }

    const result = await response.json();
    
    if (!result.hits.hits.length) {
      return NextResponse.json(
        { error: 'Artwork not found' },
        { status: 404 }
      );
    }

    const artwork = result.hits.hits[0]._source;
    
    // Return with cache headers
    return NextResponse.json(artwork, {
      headers: {
        'Cache-Control': `public, max-age=${CACHE_DURATION}, s-maxage=${CACHE_DURATION}`,
        'ETag': `"${objectId}-${artwork.metadata?.lastUpdate || 'static'}"`,
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