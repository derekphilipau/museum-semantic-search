import { NextResponse } from 'next/server';
import { getAllEmojis } from '@/lib/elasticsearch/client';

export async function GET() {
  try {
    console.log('Fetching emojis from Elasticsearch...');
    const emojis = await getAllEmojis();
    
    console.log(`Retrieved ${emojis.length} unique emojis`);
    
    // Sort by count descending
    const sortedEmojis = emojis.sort((a, b) => b.count - a.count);
    
    return NextResponse.json({
      emojis: sortedEmojis,
      total: sortedEmojis.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching emojis:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch emojis',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined
      },
      { status: 500 }
    );
  }
}