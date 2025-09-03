import { NextResponse } from 'next/server';
import { getAllEmojis } from '@/lib/elasticsearch/client';

export async function GET() {
  try {
    const emojis = await getAllEmojis();
    
    // Sort by count descending
    const sortedEmojis = emojis.sort((a, b) => b.count - a.count);
    
    return NextResponse.json({
      emojis: sortedEmojis,
      total: sortedEmojis.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching emojis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emojis' },
      { status: 500 }
    );
  }
}