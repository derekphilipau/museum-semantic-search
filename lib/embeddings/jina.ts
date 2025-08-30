import { EmbeddingResponse } from './types';

export async function generateJinaEmbedding(
  text: string,
  modelId: string = 'jina-clip-v2'
): Promise<EmbeddingResponse> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error('JINA_API_KEY not configured');
  }

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      input: [{
        text: text
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;

  // Map model ID to our internal model key
  const modelKey = modelId === 'jina-clip-v2' ? 'jina_clip_v2' : 
                   modelId === 'jina-embeddings-v4' ? 'jina_embeddings_v4' : modelId;

  return {
    embedding,
    model: modelKey,
    dimension: embedding.length,
  };
}