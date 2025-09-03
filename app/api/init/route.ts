import { NextResponse } from 'next/server';
import { warmupEmbeddingService } from '@/lib/embeddings/warmup';

// This endpoint can be called on app startup to warm up services
export async function GET() {
  try {
    // Warm up the Modal embedding service
    await warmupEmbeddingService();
    
    return NextResponse.json({
      status: 'success',
      message: 'Services warmed up successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in init endpoint:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to warm up services',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}