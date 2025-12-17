import { EmbeddingBatchResult, EmbeddingVector } from './types';

// Retry helper for transient network errors (DNS EBUSY, connection reset, etc.)
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error as Error;
      const errorCode = (error as NodeJS.ErrnoException).code;

      // Only retry on transient DNS/network errors
      const isRetryable =
        errorCode === 'EBUSY' ||
        errorCode === 'ENOTFOUND' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'ECONNRESET' ||
        errorCode === 'ECONNREFUSED';

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = 100 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

const JINA_API_URL =
  process.env.JINA_API_URL?.trim() || 'https://api.jina.ai/v1/embeddings';
const JINA_IMAGE_MODEL =
  process.env.JINA_IMAGE_EMBED_MODEL?.trim() || 'jina-clip-v2';
const JINA_TEXT_MODEL =
  process.env.JINA_TEXT_EMBED_MODEL?.trim() || 'jina-embeddings-v3';

function getJinaApiKey(): string {
  const key =
    process.env.JINA_API_KEY?.trim() ||
    process.env.JINA_API_TOKEN?.trim();
  if (!key) {
    throw new Error('JINA_API_KEY is not configured');
  }
  return key;
}

interface JinaEmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

export async function embedJinaClipImage(
  base64: string,
  mimeType = 'image/jpeg'
): Promise<EmbeddingVector> {
  const apiKey = getJinaApiKey();

  const imageData = base64.startsWith('data:')
    ? base64
    : `data:${mimeType};base64,${base64}`;

  const response = await fetchWithRetry(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: JINA_IMAGE_MODEL,
      input: [
        {
          image: imageData,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail =
        typeof parsed === 'string'
          ? parsed
          : parsed?.detail || JSON.stringify(parsed);
    } catch {
      // ignore JSON parse errors
    }
    const error = new Error(
      `Jina embeddings API error: ${response.status} ${response.statusText} - ${detail}`
    ) as Error & { status?: number; detail?: string };
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const payload = (await response.json()) as JinaEmbeddingResponse;

  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Jina embeddings API returned an empty embedding');
  }

  return {
    model: 'jina_clip',
    values: embedding,
    dimension: embedding.length,
  };
}

export async function embedJinaClipText(
  text: string
): Promise<EmbeddingVector> {
  const apiKey = getJinaApiKey();

  const response = await fetchWithRetry(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: JINA_IMAGE_MODEL,
      input: [
        {
          text,
        },
      ],
    }),
  });

  if (!response.ok) {
    const textResponse = await response.text();
    let detail = textResponse;
    try {
      const parsed = JSON.parse(textResponse);
      detail =
        typeof parsed === 'string'
          ? parsed
          : parsed?.detail || JSON.stringify(parsed);
    } catch {
      // ignore JSON parse errors
    }
    const error = new Error(
      `Jina embeddings API error: ${response.status} ${response.statusText} - ${detail}`
    ) as Error & { status?: number; detail?: string };
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const payload = (await response.json()) as JinaEmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Jina embeddings API returned an empty embedding');
  }

  return {
    model: 'jina_clip',
    values: embedding,
    dimension: embedding.length,
  };
}

export async function embedJinaTextBatch(
  texts: string[]
): Promise<EmbeddingBatchResult> {
  if (!texts.length) {
    return { model: 'jina_text', vectors: [] } as EmbeddingBatchResult;
  }

  const apiKey = getJinaApiKey();

  const response = await fetchWithRetry(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: JINA_TEXT_MODEL,
      input: texts.map((text) => ({ text })),
    }),
  });

  if (!response.ok) {
    const textResponse = await response.text();
    let detail = textResponse;
    try {
      const parsed = JSON.parse(textResponse);
      detail =
        typeof parsed === 'string'
          ? parsed
          : parsed?.detail || JSON.stringify(parsed);
    } catch {
      // ignore JSON parse errors
    }
    const error = new Error(
      `Jina embeddings API error: ${response.status} ${response.statusText} - ${detail}`
    ) as Error & { status?: number; detail?: string };
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const payload = (await response.json()) as JinaEmbeddingResponse;
  const vectors: EmbeddingVector[] = (payload.data ?? []).map((item) => {
    const embedding = item.embedding ?? [];
    const dimension = embedding.length;
    return {
      model: 'jina_text',
      values: embedding,
      dimension,
    };
  });

  if (vectors.length !== texts.length) {
    throw new Error(
      `Jina embeddings API returned ${vectors.length} embeddings for ${texts.length} inputs`
    );
  }

  if (vectors.some((v) => v.values.length === 0)) {
    throw new Error('Jina embeddings API returned an empty embedding');
  }

  return { model: 'jina_text', vectors };
}

export async function embedJinaText(
  text: string
): Promise<EmbeddingVector> {
  const batch = await embedJinaTextBatch([text]);
  if (!batch.vectors.length) {
    throw new Error('Jina embeddings API returned an empty embedding');
  }
  return batch.vectors[0];
}
