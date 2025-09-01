/**
 * Jina v3 embeddings client
 * 
 * Note: For search time, we need to use task="retrieval.query"
 * For indexing, the Python script uses task="retrieval.passage"
 */

interface JinaEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

export async function generateJinaV3Embedding(
  text: string,
  apiKey?: string
): Promise<{ embedding: number[]; model: string; dimensions: number }> {
  const key = apiKey || process.env.JINA_API_KEY;
  if (!key) {
    throw new Error('JINA_API_KEY environment variable is required');
  }

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text],
      task: 'retrieval.query', // For search queries
      dimensions: 768, // Match our indexed embeddings
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.status} ${error}`);
  }

  const data: JinaEmbeddingResponse = await response.json();
  
  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid response from Jina API');
  }

  return {
    embedding: data.data[0].embedding,
    model: 'jina_v3',
    dimensions: data.data[0].embedding.length,
  };
}