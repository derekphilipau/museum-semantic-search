import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { ProjectionPoint, EmbeddingType, ProjectionType } from '@/app/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const embeddingType =
    (searchParams.get('embeddingType') as EmbeddingType) || 'jina_text';
  const projectionType = searchParams.get('projectionType') as ProjectionType || 'standard_2d';
  
  try {
    // Construct file path
    const dataPath = path.join(
      process.cwd(),
      'data',
      'met',
      'projections',
      embeddingType,
      `${projectionType}.jsonl`
    );
    
    // Read the file
    const fileContent = await readFile(dataPath, 'utf-8');
    
    // Parse JSONL
    const points: ProjectionPoint[] = fileContent
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    
    // Return response with proper headers
    return NextResponse.json(
      {
        embeddingType,
        projectionType,
        count: points.length,
        points
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        }
      }
    );
  } catch (error) {
    console.error('Error loading projection data:', error);
    return NextResponse.json(
      { error: 'Failed to load projection data' },
      { status: 500 }
    );
  }
}
