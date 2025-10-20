import { NextResponse } from 'next/server';
import { getElasticsearchClient, INDEX_NAME } from '@/lib/elasticsearch/client';
import { ProjectionType, EmbeddingType } from '@/app/types';

interface MinimalProjectionPoint {
  id: string;
  coords: [number, number];
  // Minimal fields for visualization
  artist?: string;
  date?: string;
  tags?: string[];
  title?: string;
}

interface MinimalElasticsearchArtwork {
  id: string;
  title?: string;
  artist?: string;
  date?: string;
  tags?: string[];
  projections?: {
    [key: string]: {
      [key: string]: number[];
    };
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const embeddingType =
    (searchParams.get('embeddingType') as EmbeddingType) || 'jina_text';
  const projectionType = searchParams.get('projectionType') as ProjectionType || 'standard_2d';
  
  try {
    const client = getElasticsearchClient();
    
    // Query all artworks with projections - minimal fields only
    const response = await client.search({
      index: INDEX_NAME,
      size: 10000,
      _source: [
        'id',
        'title',
        'artist',
        'date',
        'tags',
        `projections.${embeddingType}.${projectionType}`
      ],
      query: {
        exists: {
          field: `projections.${embeddingType}.${projectionType}`
        }
      }
    });
    
    // Transform to minimal format
    const points: MinimalProjectionPoint[] = response.hits.hits.map((hit) => {
      const source = hit._source as MinimalElasticsearchArtwork;
      const coordinates = source.projections?.[embeddingType]?.[projectionType];
      
      return {
        id: source.id,
        coords: coordinates as [number, number] || [0, 0],
        artist: source.artist || '',
        date: source.date || '',
        tags: source.tags || [],
        title: source.title || ''
      };
    });
    
    return NextResponse.json(
      { points },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        }
      }
    );
  } catch (error) {
    console.error('Error loading minimal projections:', error);
    return NextResponse.json(
      { error: 'Failed to load projection data' },
      { status: 500 }
    );
  }
}
