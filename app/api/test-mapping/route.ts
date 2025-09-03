import { NextResponse } from 'next/server';
import { getElasticsearchClient, INDEX_NAME } from '@/lib/elasticsearch/client';

export async function GET() {
  try {
    const client = getElasticsearchClient();
    
    // Get index mapping
    const mapping = await client.indices.getMapping({
      index: INDEX_NAME
    });
    
    // Get a sample document to see the structure
    const sampleDoc = await client.search({
      index: INDEX_NAME,
      size: 1,
      query: {
        exists: {
          field: 'visual_emoji_array'
        }
      }
    });
    
    // Get field capabilities for visual_emoji_array
    const fieldCaps = await client.fieldCaps({
      index: INDEX_NAME,
      fields: ['visual_emoji_array', 'visual_emoji_summary']
    });
    
    return NextResponse.json({
      indexName: INDEX_NAME,
      mapping: mapping[INDEX_NAME]?.mappings?.properties,
      sampleDocument: sampleDoc.hits.hits[0]?._source,
      fieldCapabilities: fieldCaps.fields
    });
  } catch (error) {
    console.error('Error testing mapping:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get mapping',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}