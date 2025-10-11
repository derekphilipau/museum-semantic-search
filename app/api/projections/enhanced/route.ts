import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { ProjectionPoint, EmbeddingType, ProjectionType } from '@/app/types';

interface EnhancedProjectionPoint extends ProjectionPoint {
  enhancedMetadata?: {
    visual_description?: {
      alt_text: string;
      long_description: string;
    };
    primaryImage?: string;
    primaryImageSmall?: string;
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const embeddingType =
    (searchParams.get('embeddingType') as EmbeddingType) || 'jina_text';
  const projectionType = searchParams.get('projectionType') as ProjectionType || 'standard_2d';
  
  try {
    // Load projection data
    const projectionPath = path.join(
      process.cwd(),
      'data',
      'met',
      'projections',
      embeddingType,
      `${projectionType}.jsonl`
    );
    
    const projectionContent = await readFile(projectionPath, 'utf-8');
    const points: ProjectionPoint[] = projectionContent
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    
    // Try to load visual descriptions
    const descriptionsPath = path.join(
      process.cwd(),
      'data',
      'met',
      'edited_descriptions.jsonl'
    );
    
    const descriptionsMap = new Map();
    
    try {
      const descriptionsContent = await readFile(descriptionsPath, 'utf-8');
      descriptionsContent.trim().split('\n').forEach(line => {
        const data = JSON.parse(line);
        const id = data.artwork_id || data.id;
        descriptionsMap.set(id, data);
      });
    } catch {
      console.log('Could not load edited descriptions, trying original descriptions');
      
      try {
        const originalDescPath = path.join(
          process.cwd(),
          'data',
          'met',
          'descriptions.jsonl'
        );
        const originalContent = await readFile(originalDescPath, 'utf-8');
        originalContent.trim().split('\n').forEach(line => {
          const data = JSON.parse(line);
          const id = data.artwork_id || data.id;
          descriptionsMap.set(id, data);
        });
      } catch {
        console.log('Could not load descriptions');
      }
    }
    
    // Load CSV data for complete metadata and image URLs
    const csvPath = path.join(process.cwd(), 'data', 'met', 'MetPaintingsWithImages.csv');
    const csvDataMap = new Map();
    
    try {
      const csvContent = await readFile(csvPath, 'utf-8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        bom: true
      });
      
      for (const record of records as Record<string, string>[]) {
        const objectId = record['Object ID'];
        if (objectId) {
          csvDataMap.set(`met_${objectId}`, {
            objectName: record['Object Name'] || '',
            classification: record['Classification'] || '',
            culture: record['Culture'] || '',
            period: record['Period'] || '',
            dynasty: record['Dynasty'] || '',
            reign: record['Reign'] || '',
            country: record['Country'] || '',
            primaryImage: record['primaryImage'] || '',
            primaryImageSmall: record['primaryImageSmall'] || ''
          });
        }
      }
      console.log(`Loaded ${csvDataMap.size} artwork records from CSV`);
    } catch (error) {
      console.error('Could not load CSV data:', error);
    }
    
    // Enhance points with additional metadata
    const enhancedPoints: EnhancedProjectionPoint[] = points.map(point => {
      const description = descriptionsMap.get(point.artwork_id);
      const csvData = csvDataMap.get(point.artwork_id);
      
      return {
        ...point,
        metadata: {
          ...point.metadata,
          // Add CSV metadata fields
          objectName: csvData?.objectName || '',
          classification: csvData?.classification || '',
          culture: csvData?.culture || '',
          period: csvData?.period || '',
          dynasty: csvData?.dynasty || '',
          reign: csvData?.reign || '',
          country: csvData?.country || '',
          // Visual description
          alt_text: description?.alt_text || point.metadata.alt_text || '',
          // Use image from metadata
          image: point.metadata.image || ''
        },
        enhancedMetadata: {
          visual_description: description ? {
            alt_text: description.alt_text || '',
            long_description: description.long_description || ''
          } : undefined,
          primaryImage: csvData?.primaryImage || '',
          primaryImageSmall: csvData?.primaryImageSmall || ''
        }
      };
    });
    
    return NextResponse.json(
      {
        embeddingType,
        projectionType,
        count: enhancedPoints.length,
        points: enhancedPoints
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
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
