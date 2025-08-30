import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding, ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings';

// Type guard for model validation
function isValidModel(model: any): model is ModelKey {
  return model in EMBEDDING_MODELS;
}

// Get allowed origins from environment or use defaults
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim());
  return envOrigins?.length ? envOrigins : ['http://localhost:3000'];
}

// Helper to get CORS headers
function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

export async function POST(request: NextRequest) {
  try {
    const { text, model } = await request.json();

    // Validate text parameter
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text parameter is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate text length (prevent extremely large inputs)
    const MAX_TEXT_LENGTH = 10000; // Adjust based on your needs
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text too long. Maximum length: ${MAX_TEXT_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Validate model parameter
    if (!model || !isValidModel(model)) {
      return NextResponse.json(
        { error: `Invalid model. Must be one of: ${Object.keys(EMBEDDING_MODELS).join(', ')}` },
        { status: 400 }
      );
    }

    const embedding = await generateEmbedding(text, model);

    return NextResponse.json(embedding, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error('Embedding generation error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate embedding';
    const statusCode = error instanceof Error && 'statusCode' in error ? 
      (error as any).statusCode : 500;
    
    return NextResponse.json(
      { error: errorMessage },
      { 
        status: statusCode,
        headers: getCorsHeaders(request),
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}