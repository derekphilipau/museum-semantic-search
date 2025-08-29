import { EmbeddingResponse } from './types';

export async function generateCohereEmbedding(
  text: string,
  modelId: string = 'embed-v4.0'
): Promise<EmbeddingResponse> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error('COHERE_API_KEY not configured');
  }

  const response = await fetch('https://api.cohere.com/v2/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      texts: [text],
      input_type: 'search_document',
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cohere API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.embeddings.float[0];

  return {
    embedding,
    model: 'cohere_embed_4',
    dimension: embedding.length,
  };
}