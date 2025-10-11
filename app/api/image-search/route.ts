import { NextRequest, NextResponse } from 'next/server';
import { embedJinaClipImage } from '@/lib/embeddings';
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

    const [prefix, payload] = image.split(',');
    const mimeMatch = prefix?.match(/^data:(.*?);base64$/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const base64Data = payload ?? prefix ?? '';

    if (!base64Data) {
      return NextResponse.json(
        { error: 'Invalid image payload' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const embedStart = Date.now();
    const embeddingVector = await embedJinaClipImage(base64Data, mimeType);
    const embeddingTime = (Date.now() - embedStart) / 1000;

    // Perform semantic search with the image embedding
    const [searchResults, indexStats] = await Promise.all([
      performSemanticSearchWithEmbedding(
        embeddingVector.values,
        'jina_clip',
        20
      ),
      getIndexStats()
    ]);

    // Calculate total query time
    const totalQueryTime = Date.now() - queryStartTime;

    // Format response similar to text search
    const response = {
      keyword: null,
      semantic: {
        jina_clip: searchResults
      },
      hybrid: null,
      metadata: {
        ...(indexStats || {}),
        timestamp: new Date().toISOString(),
        totalQueryTime,
        searchMode: 'image',
        embeddingTime,
        esQueries: {
          semantic: {
            jina_clip: {
              note: 'Image similarity search using Jina CLIP v2 embeddings',
              model: 'jina_clip',
              dimension: embeddingVector.dimension
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
      (error as Error & { statusCode: number }).statusCode : 500;
    
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
