import { NextRequest, NextResponse } from 'next/server';
import { ModelKey } from '@/lib/embeddings/types';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'met_artworks_v2';

export async function POST(request: NextRequest) {
  try {
    const { objectId, model, size = 10 } = await request.json();

    if (!objectId || !model) {
      return NextResponse.json(
        { error: 'objectId and model are required' },
        { status: 400 }
      );
    }

    // First, get the artwork's embedding
    const getResponse = await fetch(`${ES_URL}/${INDEX_NAME}/_search`, {
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

    if (!getResponse.ok) {
      throw new Error('Failed to fetch artwork');
    }

    const getResult = await getResponse.json();
    if (!getResult.hits.hits.length) {
      return NextResponse.json(
        { error: 'Artwork not found' },
        { status: 404 }
      );
    }

    const artwork = getResult.hits.hits[0]._source;
    const embedding = artwork.embeddings?.[model];

    if (!embedding) {
      return NextResponse.json(
        { error: `No embedding found for model ${model}` },
        { status: 404 }
      );
    }

    // Search for similar artworks using the embedding
    const searchResponse = await fetch(`${ES_URL}/${INDEX_NAME}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knn: {
          field: `embeddings.${model}`,
          query_vector: embedding,
          k: size + 1, // +1 to exclude the source artwork
          num_candidates: 50
        },
        size: size + 1,
        _source: ['id', 'metadata', 'image']
      })
    });

    if (!searchResponse.ok) {
      throw new Error('Search failed');
    }

    const searchResult = await searchResponse.json();
    
    // Filter out the source artwork from results
    const filteredHits = searchResult.hits.hits.filter(
      (hit: any) => hit._source.metadata.objectId !== objectId
    );

    return NextResponse.json({
      took: searchResult.took,
      total: filteredHits.length,
      hits: filteredHits.slice(0, size)
    });

  } catch (error) {
    console.error('Similar search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}