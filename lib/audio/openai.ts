const OPENAI_API_BASE =
  process.env.OPENAI_API_BASE?.replace(/\/+$/, '') ??
  'https://api.openai.com/v1';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface TranscriptionResult {
  text: string;
  durationMs?: number;
  raw?: unknown;
}

export interface SynthesisResult {
  base64: string;
  mimeType: string;
}

function ensureApiKey() {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. Voice mode requires a valid OpenAI API key.'
    );
  }
}

function createError(message: string, status?: number, cause?: unknown) {
  const error = new Error(message);
  if (status) {
    Object.assign(error, { status });
  }
  if (cause) {
    Object.assign(error, { cause });
  }
  return error;
}

export async function transcribeAudio(options: {
  audio: ArrayBuffer;
  mimeType?: string;
  language?: string;
  responseFormat?: string;
  model?: string;
}): Promise<TranscriptionResult> {
  ensureApiKey();

  const {
    audio,
    mimeType = 'audio/webm',
    language = 'en',
    responseFormat = 'json',
    model = 'gpt-4o-mini-transcribe',
  } = options;

  const formData = new FormData();
  const fileName = `audio-${Date.now()}.webm`;
  formData.append(
    'file',
    new Blob([audio], { type: mimeType }),
    fileName
  );
  formData.append('model', model);
  formData.append('temperature', '0');
  formData.append('response_format', responseFormat);
  formData.append('language', language);

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    throw createError(
      `Transcription failed with status ${response.status}`,
      response.status,
      details
    );
  }

  const payload = (await response.json()) as {
    text?: string;
    duration?: number;
  };

  if (!payload.text) {
    throw createError('Transcription response did not include text');
  }

  return {
    text: payload.text.trim(),
    durationMs:
      typeof payload.duration === 'number'
        ? Math.round(payload.duration * 1000)
        : undefined,
    raw: payload,
  };
}

export async function synthesizeSpeech(options: {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'ogg';
  model?: string;
}): Promise<SynthesisResult> {
  ensureApiKey();

  const {
    text,
    voice = process.env.OPENAI_TTS_VOICE ?? 'alloy',
    format = 'mp3',
    model = 'gpt-4o-mini-tts',
  } = options;

  const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      format,
    }),
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    throw createError(
      `TTS failed with status ${response.status}`,
      response.status,
      details
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mimeType =
    format === 'mp3'
      ? 'audio/mpeg'
      : format === 'wav'
        ? 'audio/wav'
        : 'audio/ogg';

  return { base64, mimeType };
}

