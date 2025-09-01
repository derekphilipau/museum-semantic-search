import { NextRequest, NextResponse } from 'next/server';
import { generateImageEmbedding, extractImageSigLIP2Embedding } from '@/lib/embeddings/image';
import { performSemanticSearchWithEmbedding, getIndexStats } from '@/lib/elasticsearch/client';

// Helper to get CORS headers
function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || ['http://localhost:3000'];
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image } = body;

    if (!image) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // Track query start time
    const queryStartTime = Date.now();

    // Generate embedding for the image using Modal API
    const embeddingResponse = await generateImageEmbedding(image);
    const siglip2Data = extractImageSigLIP2Embedding(embeddingResponse);

    // Perform semantic search with the image embedding
    const [searchResults, indexStats] = await Promise.all([
      performSemanticSearchWithEmbedding(siglip2Data.embedding, 'siglip2', 20),
      getIndexStats()
    ]);

    // Calculate total query time
    const totalQueryTime = Date.now() - queryStartTime;

    // Format response similar to text search
    const response = {
      keyword: null,
      semantic: {
        siglip2: searchResults
      },
      hybrid: null,
      metadata: {
        ...(indexStats || {}),
        timestamp: new Date().toISOString(),
        totalQueryTime,
        searchMode: 'image',
        embeddingTime: siglip2Data.processing_time,
        esQueries: {
          semantic: {
            siglip2: {
              note: 'Image similarity search using SigLIP2',
              model: 'siglip2',
              dimension: siglip2Data.dimension
            }
          }
        }
      }
    };

    return NextResponse.json(response, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error('Image search API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Image search failed';
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