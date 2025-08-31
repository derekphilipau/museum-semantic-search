import { EmbeddingResponse } from './types';

export async function generateJinaEmbedding(
  text: string,
  modelId: string = 'jina-clip-v2'
): Promise<EmbeddingResponse> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error('JINA_API_KEY not configured');
  }

  // Build request body based on model
  const requestBody: any = {
    model: modelId,
    input: [{
      text: text
    }],
  };

  // Add task parameter for v3
  if (modelId === 'jina-embeddings-v3') {
    requestBody.task = 'text-matching';
  }

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;

  // Map model ID to our internal model key
  const modelKey = modelId === 'jina-embeddings-v4' ? 'jina_embeddings_v4' : 
                   modelId === 'jina-embeddings-v3' ? 'jina_embeddings_v3' : modelId;

  return {
    embedding,
    model: modelKey,
    dimension: embedding.length,
  };
}