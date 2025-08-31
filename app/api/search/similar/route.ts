import { NextRequest, NextResponse } from 'next/server';
import { ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings/types';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

// Constants for validation
const MIN_RESULTS = 1;
const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 10;

// Type guard for model validation
function isValidModel(model: any): model is ModelKey {
  return model in EMBEDDING_MODELS;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objectId, artworkId, model, size = DEFAULT_RESULTS } = body;

    // Support both objectId (legacy) and artworkId
    const id = artworkId || objectId;
    
    // Validate ID
    if (!id) {
      return NextResponse.json(
        { error: 'artworkId is required' },
        { status: 400 }
      );
    }

    // Validate model
    if (!model || !isValidModel(model)) {
      return NextResponse.json(
        { error: `Invalid model. Must be one of: ${Object.keys(EMBEDDING_MODELS).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate and clamp size parameter
    const validatedSize = Math.max(MIN_RESULTS, Math.min(MAX_RESULTS, Number(size) || DEFAULT_RESULTS));
    if (!Number.isInteger(size) && size !== undefined) {
      return NextResponse.json(
        { error: `size must be an integer between ${MIN_RESULTS} and ${MAX_RESULTS}` },
        { status: 400 }
      );
    }

    // First, get the artwork's embedding by document ID
    const getResponse = await fetch(`${ES_URL}/${INDEX_NAME}/_doc/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!getResponse.ok) {
      throw new Error('Failed to fetch artwork');
    }

    const getResult = await getResponse.json();
    if (!getResult.found) {
      return NextResponse.json(
        { error: 'Artwork not found' },
        { status: 404 }
      );
    }

    const artwork = getResult._source;
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
          k: validatedSize + 1, // +1 to exclude the source artwork
          num_candidates: Math.min(50, validatedSize * 5) // Scale candidates with size
        },
        size: validatedSize + 1,
        _source: ['id', 'metadata', 'image']
      })
    });

    if (!searchResponse.ok) {
      throw new Error('Search failed');
    }

    const searchResult = await searchResponse.json();
    
    // Filter out the source artwork from results
    const filteredHits = searchResult.hits.hits.filter(
      (hit: any) => hit._id !== id
    );

    return NextResponse.json({
      took: searchResult.took,
      total: filteredHits.length,
      hits: filteredHits.slice(0, validatedSize)
    });

  } catch (error) {
    console.error('Similar search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}