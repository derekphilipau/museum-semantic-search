import { NextResponse } from 'next/server';
import { retrieveKnowledgeSnippets } from '@/lib/knowledge/retriever';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { artifactId, query, size = 12, embedding } = body ?? {};

    if (!artifactId || !query) {
      return NextResponse.json(
        { error: 'artifactId and query are required.' },
        { status: 400 }
      );
    }

    const snippets = await retrieveKnowledgeSnippets({
      artifactId,
      query,
      size,
      vector: embedding,
    });

    return NextResponse.json({ snippets });
  } catch (error) {
    console.error('knowledge-search error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve knowledge snippets.' },
      { status: 500 }
    );
  }
}
