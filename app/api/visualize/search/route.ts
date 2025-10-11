import { NextRequest, NextResponse } from 'next/server';
import { performSemanticSearchWithEmbedding } from '@/lib/elasticsearch/client';
import { embedJinaText, embedJinaClipText, ModelKey } from '@/lib/embeddings';
import { EmbeddingType } from '@/app/types';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  const embeddingType = (searchParams.get('embeddingType') || 'jina_text') as EmbeddingType;
  
  if (!query) {
    return NextResponse.json({ hits: [], maxScore: 0 });
  }
  
  try {
    let embedding: number[];
    let modelKey: ModelKey;

    if (embeddingType === 'jina_clip') {
      const vector = await embedJinaClipText(query);
      embedding = vector.values;
      modelKey = 'jina_clip';
    } else {
      const vector = await embedJinaText(query);
      embedding = vector.values;
      modelKey = 'jina_text';
    }
    
    // Use pure semantic search with the specific embedding
    const results = await performSemanticSearchWithEmbedding(
      embedding,
      modelKey,
      200 // Get more results for visualization
    );
    
    // Extract artwork IDs, scores, and basic metadata
    const hits = results.hits.map(hit => ({
      id: hit._source.id,
      score: hit._score,
      artwork: {
        id: hit._source.id,
        title: hit._source.title,
        artist: hit._source.artist,
        date: hit._source.date,
        // Include the full image object to support thumbnailUrl
        image: hit._source.image,
        // Keep primaryImageSmall for backwards compatibility
        primaryImageSmall: typeof hit._source.image === 'object' && hit._source.image?.thumbnailUrl 
          ? hit._source.image.thumbnailUrl 
          : typeof hit._source.image === 'string' ? hit._source.image : '',
        medium: hit._source.medium,
        department: hit._source.department
      }
    }));
    
    const maxScore = hits[0]?.score || 1;
    
    return NextResponse.json({ 
      hits,
      maxScore,
      total: results.total
    });
  } catch (error) {
    console.error('Explore search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
