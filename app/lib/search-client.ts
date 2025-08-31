'use client';

import { SearchResponse } from '@/app/types';

interface SearchOptions {
  keyword: boolean;
  models: Record<string, boolean>;
  hybrid: boolean;
}

interface UnifiedSearchResponse {
  keyword: SearchResponse | null;
  semantic: Record<string, SearchResponse>;
  hybrid: { model: string; results: SearchResponse } | null;
}

interface SearchRequest {
  query: string;
  options: SearchOptions;
  size?: number;
}

export async function searchArtworks(
  query: string, 
  options: SearchOptions, 
  size: number = 10
): Promise<UnifiedSearchResponse> {
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        options,
        size
      } as SearchRequest),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Search failed: ${response.statusText}`);
    }

    const data: UnifiedSearchResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}