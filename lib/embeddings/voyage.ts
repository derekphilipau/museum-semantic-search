import { EmbeddingResponse } from './types';

export async function generateVoyageEmbedding(
  text: string,
  modelId: string = 'voyage-multimodal-3'
): Promise<EmbeddingResponse> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY not configured');
  }

  // Use multimodal endpoint even for text-only queries with multimodal models
  const isMultimodal = modelId.includes('multimodal');
  const endpoint = isMultimodal 
    ? 'https://api.voyageai.com/v1/multimodalembeddings'
    : 'https://api.voyageai.com/v1/embeddings';

  const payload = isMultimodal ? {
    model: modelId,
    inputs: [{
      content: [{
        type: 'text',
        text: text
      }]
    }],
  } : {
    model: modelId,
    input: [text],
    input_type: 'document',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;

  return {
    embedding,
    model: 'voyage_multimodal_3',
    dimension: embedding.length,
  };
}