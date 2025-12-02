import { NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/elasticsearch/client';

// Cache filter options for 1 hour (they don't change often)
export const revalidate = 3600;

export async function GET() {
  try {
    const filterOptions = await getFilterOptions();

    return NextResponse.json(filterOptions, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);

    return NextResponse.json(
      { error: 'Failed to fetch filter options' },
      { status: 500 }
    );
  }
}
