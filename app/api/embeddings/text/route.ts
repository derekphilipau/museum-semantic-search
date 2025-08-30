import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding, ModelKey } from '@/lib/embeddings';

export async function POST(request: NextRequest) {
  try {
    const { text, model } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text parameter is required' },
        { status: 400 }
      );
    }

    if (!model || !['jina_embeddings_v4', 'google_vertex_multimodal'].includes(model)) {
      return NextResponse.json(
        { error: 'Valid model parameter is required' },
        { status: 400 }
      );
    }

    const embedding = await generateEmbedding(text, model as ModelKey);

    return NextResponse.json(embedding);
  } catch (error) {
    console.error('Embedding generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate embedding' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}