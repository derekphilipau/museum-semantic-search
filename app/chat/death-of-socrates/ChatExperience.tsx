'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  ExternalLink,
  Loader2,
  Mic,
  SendHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { KnowledgeCapsule, KnowledgeSnippet } from '@/lib/knowledge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ChatExperienceProps {
  artifactId: string;
  capsule: KnowledgeCapsule | null;
}

interface SourceLink {
  title: string;
  url: string;
}

type MessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  origin?: 'text' | 'voice';
  audio?: {
    mimeType: string;
    base64: string;
  } | null;
  transcriptDurationMs?: number;
  pendingVoice?: boolean;
  relatedArtworks?: RelatedArtwork[];
  links?: SourceLink[];
  retrievalSummary?: string;
}

interface ChatResponsePayload {
  message: {
    role: MessageRole;
    content: string;
  };
  snippets: KnowledgeSnippet[];
  retrievalLog?: RetrievalLogEntry[];
  relatedArtworks?: RelatedArtwork[];
  links?: SourceLink[];
  error?: string;
}

interface VoiceChatResponsePayload extends ChatResponsePayload {
  transcript: {
    text: string;
    durationMs?: number;
  };
  audio?: {
    base64: string;
    mimeType: string;
  } | null;
}

interface RetrievalLogSnippet {
  snippetId: string;
  sourceTitle?: string;
}

interface RetrievalLogEntry {
  query: string;
  hits: number;
  source: 'planner' | 'fallback';
  rationale?: string;
  topSnippets?: RetrievalLogSnippet[];
}

interface RelatedArtwork {
  id: string;
  title: string;
  artist?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

interface ContentSegment {
  type: 'text' | 'citation';
  value: string;
}

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = /\[S:([^\]]+)\]/g;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: content.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: 'citation',
      value: match[1],
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      value: content.slice(lastIndex),
    });
  }

  return segments;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs || !Number.isFinite(durationMs)) {
    return null;
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getCoreFactsSummary(capsule?: KnowledgeCapsule | null) {
  const facts = capsule?.core_facts;
  if (!facts || typeof facts !== 'object') {
    return null;
  }

  const entries = Object.entries(facts);
  if (entries.length === 0) {
    return null;
  }

  const summary: string[] = [];
  entries.forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    if (typeof value === 'object' && 'name' in (value as Record<string, unknown>)) {
      summary.push(`${key}: ${(value as Record<string, unknown>).name}`);
      return;
    }

    summary.push(`${key}: ${String(value)}`);
  });

  return summary.join(' • ');
}

export default function ChatExperience({
  artifactId,
  capsule,
}: ChatExperienceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'intro',
      role: 'assistant',
      content:
        'Hello! I am your museum guide for Jacques-Louis David’s “The Death of Socrates.” Take a slow look across the whole scene—what detail catches your eye first?',
      createdAt: Date.now(),
    },
  ]);
  const [composer, setComposer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snippetMap, setSnippetMap] = useState<Record<string, KnowledgeSnippet>>(
    {}
  );
  const [snippetOrder, setSnippetOrder] = useState<string[]>([]);
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(
    null
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [slowLookingEnabled, setSlowLookingEnabled] = useState(true);

  const snippets = useMemo(() => {
    if (snippetOrder.length === 0) {
      return Object.values(snippetMap);
    }
    return snippetOrder
      .map((snippetId) => snippetMap[snippetId])
      .filter((snippet): snippet is KnowledgeSnippet => Boolean(snippet));
  }, [snippetMap, snippetOrder]);

  useEffect(() => {
    if (!selectedSnippetId && snippets.length > 0) {
      setSelectedSnippetId(snippets[0].snippetId);
    }
  }, [selectedSnippetId, snippets]);
  const scrollToBottom = useCallback(() => {
    if (!viewportRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    });
  }, []);

  useLayoutEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const audioMap = audioElementsRef.current;
      Object.values(audioMap).forEach((audio) => {
        audio.pause();
      });
    };
  }, []);

  const formatRetrievalSummary = useCallback(
    (log?: RetrievalLogEntry[]) => {
      if (!log || log.length === 0) {
        return 'Searched the capsule using the latest question.';
      }

      return log
        .map((entry) => {
          const label = entry.source === 'planner' ? 'Planner' : 'Fallback';
          const hits =
            entry.hits === 1 ? '1 snippet' : `${entry.hits} snippets`;
          const topSnippets =
            entry.topSnippets && entry.topSnippets.length > 0
              ? entry.topSnippets
                  .map((snippet) =>
                    snippet.sourceTitle
                      ? `${snippet.snippetId} (${snippet.sourceTitle})`
                      : snippet.snippetId
                  )
                  .join(', ')
              : null;
          const rationale = entry.rationale
            ? ` — ${entry.rationale}`
            : '';
          const topDetail = topSnippets ? ` — top: ${topSnippets}` : '';
          return `${label}: “${entry.query}” (${hits}${rationale}${topDetail})`;
        })
        .join(' • ');
    },
    []
  );

  const stopCurrentAudio = useCallback(() => {
    if (!playingMessageId) {
      return;
    }
    const existing = audioElementsRef.current[playingMessageId];
    if (existing) {
      existing.pause();
      existing.currentTime = 0;
    }
    setPlayingMessageId(null);
  }, [playingMessageId]);

  const playAudio = useCallback(
    async (
      messageId: string,
      clip: { mimeType: string; base64: string },
      autoPlay = false
    ) => {
      if (!clip?.base64) {
        return;
      }

      if (playingMessageId && playingMessageId !== messageId) {
        const active = audioElementsRef.current[playingMessageId];
        if (active) {
          active.pause();
          active.currentTime = 0;
        }
      }

      let audio = audioElementsRef.current[messageId];
      const src = `data:${clip.mimeType};base64,${clip.base64}`;

      if (!audio) {
        audio = new Audio(src);
        audio.volume = 1;
        audioElementsRef.current[messageId] = audio;
        audio.addEventListener('ended', () => {
          setPlayingMessageId((current) =>
            current === messageId ? null : current
          );
        });
        audio.addEventListener('pause', () => {
          const finished =
            Math.abs(audio.currentTime - audio.duration) < 0.05 ||
            audio.currentTime === 0;
          if (finished) {
            setPlayingMessageId((current) =>
              current === messageId ? null : current
            );
          }
        });
      } else if (audio.src !== src) {
        audio.src = src;
      } else {
        audio.currentTime = 0;
      }

      try {
        await audio.play();
        setPlayingMessageId(messageId);
      } catch (playError) {
        if (!autoPlay) {
          console.error(playError);
          setError(
            playError instanceof Error
              ? playError.message
              : 'Unable to play audio.'
          );
        }
      }
    },
    [playingMessageId, setError]
  );

  const toggleAudioPlayback = useCallback(
    (message: ChatMessage) => {
      if (!message.audio) {
        return;
      }
      if (playingMessageId === message.id) {
        stopCurrentAudio();
        return;
      }
      void playAudio(message.id, message.audio);
    },
    [playAudio, playingMessageId, stopCurrentAudio]
  );

  const submitVoiceRecording = useCallback(
    async (audioBlob: Blob) => {
      const requestMessages = messages
        .filter((msg) => msg.role !== 'system')
        .map(({ role, content }) => ({ role, content }));

      const voiceMessageId = crypto.randomUUID();
      const statusMessageId = crypto.randomUUID();

      const placeholderUser: ChatMessage = {
        id: voiceMessageId,
        role: 'user',
        content: 'Processing voice input…',
        createdAt: Date.now(),
        origin: 'voice',
        pendingVoice: true,
      };

      const statusMessage: ChatMessage = {
        id: statusMessageId,
        role: 'system',
        content: 'Transcribing audio…',
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, placeholderUser, statusMessage]);
      setIsLoading(true);
      setError(null);
      const formData = new FormData();
      formData.append('artifactId', artifactId);
      formData.append('messages', JSON.stringify(requestMessages));
      formData.append('audio', audioBlob, 'voice-input.webm');
      formData.append('slowLookingEnabled', slowLookingEnabled ? 'true' : 'false');

      try {
        const response = await fetch('/api/voice-chat', {
          method: 'POST',
          body: formData,
        });

        let payload: VoiceChatResponsePayload & { error?: string };
        try {
          payload = (await response.json()) as VoiceChatResponsePayload & {
            error?: string;
          };
        } catch (parseError) {
          throw new Error('Voice chat failed. Please retry.', {
            cause: parseError,
          });
        }

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Voice chat failed. Please retry.');
        }

        if (!payload?.message?.content) {
          throw new Error('Voice response did not include assistant content.');
        }

        const userMessage: ChatMessage = {
          id: voiceMessageId,
          role: 'user',
          content: payload.transcript?.text ?? 'Audio transcription unavailable.',
          createdAt: Date.now(),
          origin: 'voice',
          pendingVoice: false,
          transcriptDurationMs: payload.transcript?.durationMs,
        };

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: payload.message.role,
          content: payload.message.content,
          createdAt: Date.now(),
          audio: payload.audio
            ? {
                mimeType: payload.audio.mimeType,
                base64: payload.audio.base64,
              }
            : null,
          relatedArtworks: payload.relatedArtworks ?? [],
          links: payload.links ?? [],
          retrievalSummary: formatRetrievalSummary(payload.retrievalLog),
        };

        setMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.id === voiceMessageId ? { ...msg, ...userMessage } : msg
          );
          const filtered = updated.filter((msg) => msg.id !== statusMessageId);
          return [...filtered, assistantMessage];
        });

        if (payload.snippets?.length) {
          setSnippetMap((prev) => {
            const next = { ...prev };
            payload.snippets.forEach((snippet) => {
              next[snippet.snippetId] = snippet;
            });
            return next;
          });

          setSnippetOrder((prev) => {
            const next = [...prev];
            payload.snippets.forEach((snippet) => {
              if (!next.includes(snippet.snippetId)) {
                next.push(snippet.snippetId);
              }
            });
            return next;
          });
        }

        if (assistantMessage.audio) {
          void playAudio(assistantMessage.id, assistantMessage.audio, true);
        }
      } catch (voiceError) {
        console.error(voiceError);
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === statusMessageId) {
              return {
                ...msg,
                content: 'Voice request failed. Please try again.',
              };
            }
            if (msg.id === voiceMessageId) {
              return {
                ...msg,
                pendingVoice: false,
                content: 'Voice input unavailable.',
              };
            }
            return msg;
          })
        );
        setError(
          voiceError instanceof Error
            ? voiceError.message
            : 'Voice chat failed. Please try again.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      artifactId,
      formatRetrievalSummary,
      messages,
      playAudio,
      slowLookingEnabled,
      setSnippetMap,
      setSnippetOrder,
    ]
  );

  const startRecording = useCallback(async () => {
    if (isRecording || isLoading) {
      return;
    }

    if (
      typeof window === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });
      audioChunksRef.current = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener('stop', () => {
        stream.getTracks().forEach((track) => track.stop());
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (!chunks.length) {
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        void submitVoiceRecording(blob);
      });
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setError(null);
    } catch (recordError) {
      console.error(recordError);
      setError(
        recordError instanceof Error
          ? recordError.message
          : 'Unable to access the microphone.'
      );
    }
  }, [isRecording, isLoading, submitVoiceRecording]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setIsRecording(false);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer.trim() || isLoading) {
      return;
    }

    const content = composer.trim();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now(),
      origin: 'text',
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setComposer('');
    setIsLoading(true);
    setError(null);

    try {
      const requestMessages = nextMessages
        .filter((msg) => msg.role !== 'system')
        .map(({ role, content }) => ({ role, content }));

      const response = await fetch('/api/artwork-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          artifactId,
          messages: requestMessages,
          slowLookingEnabled,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unexpected error while chatting.');
      }

      const payload = (await response.json()) as ChatResponsePayload;
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: payload.message.role,
        content: payload.message.content,
        createdAt: Date.now(),
        audio: null,
        relatedArtworks: payload.relatedArtworks ?? [],
        links: payload.links ?? [],
        retrievalSummary: formatRetrievalSummary(payload.retrievalLog),
      };

      setMessages((prev) => {
        return [...prev, assistantMessage];
      });

      if (payload.snippets?.length) {
        setSnippetMap((prev) => {
          const next = { ...prev };
          payload.snippets.forEach((snippet) => {
            next[snippet.snippetId] = snippet;
          });
          return next;
        });
        setSnippetOrder((prev) => {
          const next = [...prev];
          payload.snippets.forEach((snippet) => {
            if (!next.includes(snippet.snippetId)) {
              next.push(snippet.snippetId);
            }
          });
          return next;
        });
      }
    } catch (chatError) {
      console.error(chatError);
      setMessages((prev) => prev);
      setError(
        chatError instanceof Error
          ? chatError.message
          : 'Failed to get a response. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.closest('form');
      form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }

  const coreFactsSummary = getCoreFactsSummary(capsule);

  return (
    <div className="space-y-6">
      <Card className="flex flex-col border border-border/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg font-semibold text-foreground">
              Chat About the Painting
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Responses are grounded in cached article snippets and must
              include inline citations.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Capsule Mode
            </Badge>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="slow-looking-toggle"
                className="text-xs font-medium text-muted-foreground"
              >
                Slow Looking
              </Label>
              <Switch
                id="slow-looking-toggle"
                checked={slowLookingEnabled}
                onCheckedChange={(checked) => setSlowLookingEnabled(Boolean(checked))}
                aria-label="Toggle slow looking guidance"
              />
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-1 flex-col gap-4 p-0">
          <ScrollArea className="h-[420px]" viewportRef={viewportRef}>
            <div className="space-y-6 px-6 py-4">
              {messages.map((message) => {
                if (message.role === 'system') {
                  return (
                    <div
                      key={message.id}
                      className="flex w-full justify-center"
                    >
                      <div className="max-w-xl rounded-lg border border-dashed border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {message.content}
                      </div>
                    </div>
                  );
                }

                const isAssistant = message.role === 'assistant';
                const isVoiceMessage = message.origin === 'voice';
                const durationLabel = isVoiceMessage
                  ? formatDuration(message.transcriptDurationMs ?? null)
                  : null;
                const isPlaying = playingMessageId === message.id;
                const messageRelated = message.relatedArtworks ?? [];
                const segments = parseContentSegments(message.content);

                return (
                  <div
                    key={message.id}
                    className={`flex w-full ${
                      isAssistant ? 'justify-start' : 'justify-end'
                    }`}
                  >
                    <div
                      className={`max-w-xl rounded-xl border px-4 py-3 text-sm shadow-sm ${
                        isAssistant
                          ? 'border-primary/30 bg-primary/5 text-foreground'
                          : 'border-border bg-background'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold capitalize text-muted-foreground">
                            {isAssistant ? 'Guide' : 'You'}
                          </span>
                          {isVoiceMessage && (
                            <Badge
                              variant={message.pendingVoice ? 'outline' : 'secondary'}
                              className="text-[10px] uppercase tracking-wide"
                            >
                              Voice
                            </Badge>
                          )}
                          {durationLabel && !message.pendingVoice && (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {durationLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isAssistant && message.audio && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/20"
                              onClick={() => toggleAudioPlayback(message)}
                            >
                              {isPlaying ? (
                                <>
                                  <VolumeX className="h-3 w-3" />
                                  Stop Audio
                                </>
                              ) : (
                                <>
                                  <Volume2 className="h-3 w-3" />
                                  Play Audio
                                </>
                              )}
                            </button>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(message.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 leading-relaxed">
                        {segments.map((segment, index) => {
                          if (segment.type === 'text') {
                            return (
                              <span key={index} className="whitespace-pre-wrap">
                                {segment.value}
                              </span>
                            );
                          }

                          const citationId = segment.value;
                          const snippet = snippetMap[citationId];
                          return (
                            <button
                              key={index}
                              type="button"
                              className={`mx-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                                snippet
                                  ? 'border-primary/60 text-primary hover:bg-primary/10'
                                  : 'border-border text-muted-foreground'
                              }`}
                              onClick={() => {
                                if (snippet) {
                                  setSelectedSnippetId(snippet.snippetId);
                                }
                              }}
                            >
                              [S:{citationId}]
                            </button>
                          );
                        })}
                      </div>
                      {isAssistant && message.links && message.links.length > 0 && (
                        <div className="mt-3 text-sm">
                          <span className="font-semibold text-muted-foreground">
                            Links:
                          </span>
                          <ul className="mt-1 space-y-1">
                            {message.links.map((link) => (
                              <li key={`${message.id}-${link.url}`}>
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  {link.title}
                                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {isAssistant && message.retrievalSummary && (
                        <details className="mt-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/20 p-3 text-xs text-muted-foreground">
                          <summary className="cursor-pointer font-semibold text-foreground">
                            Planner Details
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                            {message.retrievalSummary}
                          </p>
                        </details>
                      )}
                      {isAssistant && messageRelated.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Related Artworks
                          </p>
                          <div className="grid gap-3 sm:grid-cols-2">
                              {messageRelated.map((artwork) => {
                                const imageSrc = artwork.thumbnailUrl || artwork.imageUrl;
                                return (
                                  <Link
                                    key={`${message.id}-${artwork.id}-${artwork.thumbnailUrl ?? ''}`}
                                    href={`/artwork/${encodeURIComponent(artwork.id)}`}
                                    className="group block overflow-hidden rounded-lg border bg-background transition hover:border-primary"
                                  >
                                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                                      {imageSrc ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={imageSrc}
                                          alt={artwork.title}
                                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                          No image available
                                        </div>
                                      )}
                                    </div>
                                    <div className="space-y-1 p-3">
                                      <p className="text-sm font-medium leading-snug text-foreground">
                                        {artwork.title}
                                      </p>
                                      {artwork.artist && (
                                        <p className="text-xs text-muted-foreground">
                                          {artwork.artist}
                                        </p>
                                      )}
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-primary px-4 py-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking&hellip;
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <Separator />

          <div className="px-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div className="relative">
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  placeholder="Ask about the painting or share what you notice in the scene…"
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={isLoading || isRecording}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {isRecording
                    ? 'Recording… Tap Stop when you are ready for the transcript.'
                    : 'Press Enter to send, Shift+Enter for a new line.'}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={isRecording ? 'destructive' : 'outline'}
                    onClick={() => {
                      if (isRecording) {
                        stopRecording();
                      } else {
                        void startRecording();
                      }
                    }}
                    disabled={isLoading && !isRecording}
                  >
                    {isRecording ? (
                      <>
                        <Square className="mr-2 h-4 w-4" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" />
                        Speak
                      </>
                    )}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isLoading || isRecording || !composer.trim()}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      <>
                        Send
                        <SendHorizontal className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      {coreFactsSummary && (
      <Card className="border border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-primary">
            Capsule Facts Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-primary">
          {coreFactsSummary}
        </CardContent>
      </Card>
    )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Referenced Snippets
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Click a citation badge in the transcript to focus its snippet.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {snippets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask a question to fetch relevant snippets from the capsule.
            </p>
          ) : (
            snippets.map((snippet) => {
              const isActive = selectedSnippetId === snippet.snippetId;
              return (
                <div
                  key={snippet.snippetId}
                  className={`rounded-lg border p-3 transition ${isActive ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSnippetId(snippet.snippetId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedSnippetId(snippet.snippetId);
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">S:{snippet.snippetId}</Badge>
                    {snippet.sourceTitle && (
                      <span className="font-semibold text-foreground">
                        {snippet.sourceTitle}
                      </span>
                    )}
                    {snippet.sectionHeading && (
                      <span>• {snippet.sectionHeading}</span>
                    )}
                    {snippet.sourceType && <span>• {snippet.sourceType}</span>}
                    {snippet.sourceUrl && (
                      <span className="inline-flex items-center gap-1">
                        <span>•</span>
                        <a
                          href={snippet.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          View source
                          <ExternalLink
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        </a>
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-foreground">
                    {snippet.text}
                  </p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
