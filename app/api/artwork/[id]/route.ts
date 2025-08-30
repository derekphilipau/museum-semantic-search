import { NextRequest, NextResponse } from 'next/server';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'met_artworks_v2';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const objectId = parseInt(params.id);
    
    if (isNaN(objectId)) {
      return NextResponse.json(
        { error: 'Invalid object ID' },
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

    return NextResponse.json(result.hits.hits[0]._source);

  } catch (error) {
    console.error('Error fetching artwork:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch artwork' },
      { status: 500 }
    );
  }
}