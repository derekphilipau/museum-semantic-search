import { NextRequest, NextResponse } from 'next/server';
import { performHybridSearchWithEmbeddings } from '@/lib/elasticsearch/client';
import { generateUnifiedEmbeddings } from '@/lib/embeddings/unified';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  const balance = parseFloat(searchParams.get('balance') || '0.5');
  
  if (!query) {
    return NextResponse.json({ hits: [], maxScore: 0 });
  }
  
  try {
    // Get embeddings for the query
    const unifiedResponse = await generateUnifiedEmbeddings(query);
    const embeddings = {
      jina_v3: unifiedResponse.embeddings.jina_v3.embedding
    };
    
    // Use hybrid search with configurable balance
    const results = await performHybridSearchWithEmbeddings(
      query,
      embeddings,
      ['jina_v3'],
      200, // Get more results for visualization
      false, // includeDescriptions: Keep payload small
      balance
    );
    
    // Extract artwork IDs and scores
    const hits = results.hits.map(hit => ({
      id: hit._source.id,
      score: hit._score
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