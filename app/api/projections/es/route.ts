import { NextResponse } from 'next/server';
import { getElasticsearchClient, INDEX_NAME } from '@/lib/elasticsearch/client';
import { ProjectionType, EmbeddingType } from '@/app/types';

interface ElasticsearchArtwork {
  id: string;
  title?: string;
  artist?: string;
  date?: string;
  medium?: string;
  tags?: string[];
  image?: string | { url?: string; thumbnailUrl?: string };
  department?: string;
  objectName?: string;
  classification?: string;
  culture?: string;
  period?: string;
  dynasty?: string;
  reign?: string;
  country?: string;
  visual_description?: {
    alt_text?: string;
    long_description?: string;
  };
  projections?: {
    [key: string]: {
      [key: string]: number[];
    };
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const embeddingType = searchParams.get('embeddingType') as EmbeddingType || 'jina_v3';
  const projectionType = searchParams.get('projectionType') as ProjectionType || 'standard_2d';
  
  try {
    const client = getElasticsearchClient();
    
    // Query all artworks with projections
    const response = await client.search({
      index: INDEX_NAME,
      size: 10000, // Max size - consider pagination for larger datasets
      _source: [
        'id',
        'title',
        'artist',
        'date',
        'medium',
        'tags',
        'image',
        'department',
        'objectName',
        'classification',
        'culture',
        'period',
        'dynasty',
        'reign',
        'country',
        'visual_description.alt_text',
        'visual_description.long_description',
        `projections.${embeddingType}.${projectionType}`
      ],
      query: {
        exists: {
          field: `projections.${embeddingType}.${projectionType}`
        }
      }
    });
    
    // Transform ES results to match the expected format
    const points = response.hits.hits.map((hit) => {
      const source = hit._source as ElasticsearchArtwork;
      const coordinates = source.projections?.[embeddingType]?.[projectionType];
      
      return {
        artwork_id: source.id,
        embedding_type: embeddingType,
        projection_type: projectionType,
        coordinates: coordinates || [],
        metadata: {
          title: source.title || '',
          artist: source.artist || '',
          date: source.date || '',
          medium: source.medium || '',
          tags: source.tags || [],
          image: source.image || '',  // Pass through the entire image object/string
          alt_text: source.visual_description?.alt_text || '',
          // Additional metadata fields
          department: source.department || '',
          objectName: source.objectName || '',
          classification: source.classification || '',
          culture: source.culture || '',
          period: source.period || '',
          dynasty: source.dynasty || '',
          reign: source.reign || '',
          country: source.country || ''
        },
        timestamp: new Date().toISOString()
      };
    });
    
    return NextResponse.json(
      {
        embeddingType,
        projectionType,
        count: points.length,
        points
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        }
      }
    );
  } catch (error) {
    console.error('Error loading projections from Elasticsearch:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      index: INDEX_NAME,
      query: `projections.${embeddingType}.${projectionType}`
    });
    return NextResponse.json(
      { 
        error: 'Failed to load projection data',
        details: error instanceof Error ? error.message : 'Unknown error',
        index: INDEX_NAME
      },
      { status: 500 }
    );
  }
}