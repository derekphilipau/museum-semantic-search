import { NextResponse } from 'next/server';
import { getCacheStats } from '@/lib/embeddings/cache';

export async function GET() {
  const stats = getCacheStats();
  
  return NextResponse.json({
    ...stats,
    timestamp: new Date().toISOString()
  });
}