import { NextResponse } from 'next/server';
import type { KnowledgeSnippet } from '@/lib/knowledge';
import type { ArtworkSearchResult } from '@/lib/search/artworks';
import {
  SUPPORTED_ARTIFACT_ID,
  type ChatMessageInput,
} from '@/app/api/artwork-chat/route';
import { transcribeAudio, synthesizeSpeech } from '@/lib/audio/openai';
import {
  normalizeTranscript,
  stripCitationsForSpeech,
} from '@/lib/voice';

interface ChatSourceLink {
  title: string;
  url: string;
}

interface ChatResponsePayload {
  message: {
    role: 'assistant' | 'user';
    content: string;
  };
  snippets: KnowledgeSnippet[];
  retrievalLog?: {
    query: string;
    hits: number;
    source: 'planner' | 'fallback';
    rationale?: string;
  }[];
  relatedArtworks?: ArtworkSearchResult[];
  links?: ChatSourceLink[];
  error?: string;
}

export const runtime = 'nodejs';

function parseMessagesField(value: FormDataEntryValue | null): ChatMessageInput[] {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as ChatMessageInput[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      throw new Error('Failed to parse messages payload', { cause: error });
    }
    return [];
  }

  throw new Error('Invalid messages payload');
}

function buildChatRequestBody(options: {
  artifactId: string;
  messages: ChatMessageInput[];
  slowLookingEnabled?: boolean;
}) {
  return JSON.stringify({
    artifactId: options.artifactId,
    messages: options.messages,
    slowLookingEnabled: options.slowLookingEnabled,
  });
}

async function callChatRoute(
  request: Request,
  body: string
): Promise<ChatResponsePayload> {
  const url = new URL('/api/artwork-chat', request.url);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }

    const message =
      typeof details === 'object' && details && 'error' in details
        ? String((details as { error?: unknown }).error)
        : `Chat request failed with status ${response.status}`;

    throw new Error(message, { cause: details });
  }

  return (await response.json()) as ChatResponsePayload;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const artifactId = formData.get('artifactId');
    if (!artifactId || typeof artifactId !== 'string') {
      return NextResponse.json(
        { error: 'artifactId is required' },
        { status: 400 }
      );
    }

    if (artifactId !== SUPPORTED_ARTIFACT_ID) {
      return NextResponse.json(
        { error: 'Voice mode is not yet available for this artwork.' },
        { status: 400 }
      );
    }

    const rawMessages = parseMessagesField(formData.get('messages'));
    const slowLookingRaw = formData.get('slowLookingEnabled');
    const slowLookingEnabled =
      typeof slowLookingRaw === 'string'
        ? slowLookingRaw !== 'false'
        : true;
    const audioEntry = formData.get('audio');
    if (!audioEntry || !(audioEntry instanceof Blob)) {
      return NextResponse.json(
        { error: 'Audio data is required.' },
        { status: 400 }
      );
    }

    const audioBuffer = await audioEntry.arrayBuffer();
    if (audioBuffer.byteLength === 0) {
      return NextResponse.json(
        { error: 'Received empty audio payload.' },
        { status: 400 }
      );
    }

    const transcription = await transcribeAudio({
      audio: audioBuffer,
      mimeType: audioEntry.type || 'audio/webm',
    });

    const transcriptText = normalizeTranscript(transcription.text);
    if (!transcriptText) {
      return NextResponse.json(
        { error: 'Could not extract speech from audio.' },
        { status: 422 }
      );
    }

    const messages: ChatMessageInput[] = [
      ...rawMessages,
      {
        role: 'user',
        content: transcriptText,
      },
    ];

    const chatBody = buildChatRequestBody({
      artifactId,
      messages,
      slowLookingEnabled,
    });

    const chatResponse = await callChatRoute(request, chatBody);

    if (chatResponse.error) {
      return NextResponse.json(
        { error: chatResponse.error },
        { status: 502 }
      );
    }

    const assistantContent = chatResponse.message?.content ?? '';
    let speech = stripCitationsForSpeech(assistantContent);
    if (speech.includes('Observation:')) {
      speech = speech.replace(/Observation:\s*/gi, '');
    }

    let audioResult: { base64: string; mimeType: string } | null = null;
    if (speech) {
      try {
        audioResult = await synthesizeSpeech({
          text: speech,
        });
      } catch (error) {
        console.error('TTS error', error);
        audioResult = null;
      }
    }

    return NextResponse.json({
      transcript: {
        text: transcriptText,
        durationMs: transcription.durationMs,
      },
      message: chatResponse.message,
      snippets: chatResponse.snippets,
      retrievalLog: chatResponse.retrievalLog,
      relatedArtworks: chatResponse.relatedArtworks ?? [],
      links: chatResponse.links ?? [],
      audio: audioResult,
    });
  } catch (error) {
    console.error('Voice chat error', error);
    const message =
      error instanceof Error ? error.message : 'Voice chat failed unexpectedly.';
    const status = error instanceof Error && 'status' in error ? Number(error.status) : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
