'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Loader2, SendHorizontal, Sparkles, X } from 'lucide-react';
import { KnowledgeCapsule, KnowledgeSnippet } from '@/lib/knowledge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface ChatExperienceProps {
  artifactId: string;
  capsule: KnowledgeCapsule | null;
}

type MessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

interface ChatResponsePayload {
  message: {
    role: MessageRole;
    content: string;
  };
  snippets: KnowledgeSnippet[];
  retrievalLog?: RetrievalLogEntry[];
  error?: string;
}

interface RetrievalLogEntry {
  query: string;
  hits: number;
  source: 'planner' | 'fallback';
  rationale?: string;
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
          const rationale = entry.rationale
            ? ` — ${entry.rationale}`
            : '';
          return `${label}: “${entry.query}” (${hits}${rationale})`;
        })
        .join(' • ');
    },
    []
  );

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
    };
    const searchMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: 'Searching capsule…',
      createdAt: Date.now(),
    };

    const nextMessages = [...messages, userMessage, searchMessage];
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
      };

      const retrievalSummary = formatRetrievalSummary(
        payload.retrievalLog
      );

      setMessages((prev) => {
        const updated = prev.map((msg) =>
          msg.id === searchMessage.id
            ? { ...msg, content: retrievalSummary }
            : msg
        );
        return [...updated, assistantMessage];
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
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === searchMessage.id
            ? {
                ...msg,
                content: 'Search failed. Please try again.',
              }
            : msg
        )
      );
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

      <Card className="flex flex-col border border-border/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg font-semibold text-foreground">
              Chat About the Painting
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Responses are grounded in cached Wikipedia snippets and must
              include inline citations.
            </p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Capsule Mode
          </Badge>
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
                let observationText: string | null = null;
                let factualContent = message.content;

                if (isAssistant) {
                  const markerIndex = message.content.indexOf('\n\nObservation:');
                  if (markerIndex >= 0) {
                    observationText = message.content.slice(markerIndex + 2).trim();
                    factualContent = message.content.slice(0, markerIndex);
                  }
                }

                const segments = parseContentSegments(factualContent);
                const observationQuestion = observationText
                  ? observationText.replace(/^Observation:\s*/i, '').trim()
                  : null;

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
                        <span className="font-semibold capitalize text-muted-foreground">
                          {isAssistant ? 'Guide' : 'You'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(message.createdAt)}
                        </span>
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
                      {isAssistant && observationQuestion && (
                        <div className="mt-3 flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                          <div className="flex items-start justify-between gap-4">
                            <span>
                              <span className="font-semibold not-italic">Observation:</span>{' '}
                              <span className="italic">{observationQuestion}</span>
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-xs text-primary/80 transition hover:border-primary/50 hover:bg-primary/20"
                              onClick={() => setComposer('Just the facts, please.')}
                            >
                              <X className="h-3 w-3" />
                              Skip
                            </button>
                          </div>
                          <span className="text-xs text-primary/90">
                            Want only facts? Press Skip or just reply with your next question.
                          </span>
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
                    Thinking with capsule snippets&hellip;
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
                  disabled={isLoading}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Press Enter to send, Shift+Enter for a new line.</span>
                <Button type="submit" size="sm" disabled={isLoading || !composer.trim()}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      Send
                      <SendHorizontal className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

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
                    {snippet.sourceType && (
                      <span>• {snippet.sourceType}</span>
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
