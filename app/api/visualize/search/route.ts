import { NextRequest, NextResponse } from 'next/server';
import { performSemanticSearchWithEmbedding } from '@/lib/elasticsearch/client';
import { generateUnifiedEmbeddings, extractJinaV3Embedding, extractSigLIP2Embedding } from '@/lib/embeddings';
import { EmbeddingType } from '@/app/types';
import { ModelKey } from '@/lib/embeddings/types';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  const embeddingType = (searchParams.get('embeddingType') || 'jina_v3') as EmbeddingType;
  
  if (!query) {
    return NextResponse.json({ hits: [], maxScore: 0 });
  }
  
  try {
    // Get embeddings for the query
    const unifiedResponse = await generateUnifiedEmbeddings(query);
    
    // Extract the specific embedding based on visualization type
    let embedding: number[];
    let modelKey: ModelKey;
    
    if (embeddingType === 'siglip2') {
      embedding = extractSigLIP2Embedding(unifiedResponse).embedding;
      modelKey = 'siglip2';
    } else {
      embedding = extractJinaV3Embedding(unifiedResponse).embedding;
      modelKey = 'jina_v3';
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