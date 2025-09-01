import { NextRequest, NextResponse } from 'next/server';
import { ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { findSimilarArtworks } from '@/lib/elasticsearch/client';

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

    // Use the utility function to find similar artworks
    const searchResult = await findSimilarArtworks(id, model, validatedSize);

    if (searchResult.total === 0) {
      return NextResponse.json(
        { error: 'Artwork not found or no embedding available' },
        { status: 404 }
      );
    }

    return NextResponse.json(searchResult);

  } catch (error) {
    console.error('Similar search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}