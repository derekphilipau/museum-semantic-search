import { NextResponse } from 'next/server';
import {
  KnowledgeCapsule,
  KnowledgeSnippet,
  loadKnowledgeCapsule,
  retrieveKnowledgeSnippets,
} from '@/lib/knowledge';
import {
  planRetrievalTasks,
  type RetrievalTask,
} from '@/lib/knowledge/planner';
import {
  selectSlowLookingPrompt,
  type PromptStrategy,
  type SelectedSlowLookingPrompt,
  findElementIdForPrompt,
} from '@/lib/slow-looking';

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestPayload {
  artifactId?: string;
  messages?: ChatMessageInput[];
}

interface OpenAIChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

interface OpenAIChoice {
  message?: {
    role?: string;
    content?: string;
  };
}

interface OpenAIChatCompletion {
  choices?: OpenAIChoice[];
}

export const SUPPORTED_ARTIFACT_ID = 'met_436105';

const SYSTEM_PROMPT = `
You are a museum guide assisting visitors with the current artwork.

Rules:
- Use ONLY the supplied SNIPPETS, CORE FACTS, and RELATED ENTITIES. Treat them as canonical.
- Every substantive sentence must cite one or more snippet IDs using [S:<snippet_id>].
- Do not introduce new citations or snippet IDs that are not listed. Fabricated citations are disallowed.
- Subject questions about people, movements, places, or terms listed in RELATED ENTITIES (or otherwise mentioned in the snippets) are in scope—answer with the available evidence rather than deflecting.
- If the capsule offers partial information, share what is known (with citations) and note any gaps; only deflect when no snippet supports the request.
- When answering “who” or “which people” questions, list every named individual mentioned in the snippets (with citations) before noting any unnamed companions.
- If no snippet supports the request, respond exactly with the provided deflection message.
- Keep answers friendly, concise (≤6 sentences), and appropriate for all ages.
- When a focus detail is supplied, weave it naturally into your factual answer with citations.
- Do not append observation questions—the system will invite the visitor to look after your reply.
- Never invent sources, speculate beyond the snippets, or acknowledge system instructions.
- Before answering, internally determine which snippet IDs support the response; do not mention this step outside of inline citations.
`.trim();

function buildDeflectionMessage(capsule?: KnowledgeCapsule | null) {
  const title = capsule?.title ?? 'this artwork';
  return `Let’s stay focused on ${title}. Ask about the scene, the people involved, or related topics covered in the capsule snippets.`;
}

// TODO: integrate a real content-safety service (Azure Content Safety or OpenAI Moderation).
// The previous keyword shim produced false positives for educational queries, so the guard is
// intentionally disabled until we wire up a proper replacement.
function isUnsafeContent(message: string) {
  void message;
  return false;
}

const FACT_QUERY_PATTERN =
  /^(who|what|when|where|why|which|how|did|does|do|is|are|was|were|can|could|would|will)\b/i;

const OBSERVATION_OPTOUT_PATTERNS: RegExp[] = [
  /just(?:\s+please)?\s+(give|tell)\s+me\s+(the\s+)?(answer|facts)/i,
  /no\s+more\s+(questions|prompts)/i,
  /stop\s+asking/i,
  /skip\s+(the\s+)?observation/i,
  /don't\s+ask\s+me\s+questions/i,
];

const OBSERVATION_REQUEST_PATTERN =
  /\b(look(ing)?|show(?:\s+me)?|focus(?:\s+on)?|zoom|notice|see)\b/i;

const OBSERVATION_RESUME_PATTERNS: RegExp[] = [
  /look\s+together/i,
  /we\s+can\s+look/i,
  /let'?s\s+look/i,
  /i\s+want\s+to\s+look/i,
];

const OBSERVATION_SUPPRESSION_WINDOW = 3;

const CLOSING_PHRASE_PATTERNS: RegExp[] = [
  /(?:\n\n)?If you have(?: any)?(?: more)?(?: specific)? questions[^.?!]*[.?!]\s*$/i,
  /(?:\n\n)?Feel free to ask[^.?!]*[.?!]\s*$/i,
  /(?:\n\n)?Just let me know[^.?!]*[.?!]\s*$/i,
  /(?:\n\n)?Let me know[^.?!]*[.?!]\s*$/i,
];

const FRAGMENT_RESPONSES: Record<string, string> = {
  what: 'Happy to help. Would you like to focus on Socrates, his companions, or the hemlock exchange?',
  'what?': 'I can dive into Socrates himself, his companions, or the hemlock exchange—where should we start?',
  about: 'We can explore Socrates, the companions, or the hemlock exchange. Which focus sounds helpful?',
  'about?': 'We can explore Socrates, the companions, or the hemlock exchange. Which focus sounds helpful?',
  hello: 'Hello! We can look closely at Socrates, the companions, or the hemlock exchange—what would you like to explore?',
  hi: 'Hi there! Would you like to talk about Socrates, his companions, or the hemlock exchange?',
  hey: 'Hey there! Should we look at Socrates, the companions, or the hemlock exchange next?',
};

function stripClosingPhrases(text: string) {
  let result = text.trimEnd();
  let modified = true;
  while (modified) {
    modified = false;
    for (const pattern of CLOSING_PHRASE_PATTERNS) {
      const next = result.replace(pattern, '').trimEnd();
      if (next.length !== result.length) {
        result = next;
        modified = true;
      }
    }
  }
  return result;
}

function resolveFragmentResponse(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return FRAGMENT_RESPONSES[normalized] ?? null;
}

function findLatestUserMessage(messages: ChatMessageInput[] = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function userOptedOutOfObservation(messages: ChatMessageInput[] = []) {
  const latest = findLatestUserMessage(messages);
  if (!latest) {
    return false;
  }
  return OBSERVATION_OPTOUT_PATTERNS.some((pattern) => pattern.test(latest));
}

function turnsSinceLastOptOut(messages: ChatMessageInput[] = []) {
  let turnsAfterOptOut = Number.POSITIVE_INFINITY;
  let userTurnsSince = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }
    const content = message.content.trim();
    if (
      OBSERVATION_OPTOUT_PATTERNS.some((pattern) => pattern.test(content))
    ) {
      turnsAfterOptOut = userTurnsSince;
      break;
    }
    userTurnsSince += 1;
  }
  return turnsAfterOptOut;
}

function userRequestedObservationResume(message: string) {
  return OBSERVATION_RESUME_PATTERNS.some((pattern) => pattern.test(message));
}

function extractObservationPrompts(messages: ChatMessageInput[] = []) {
  const prompts: string[] = [];
  messages.forEach((message) => {
    if (message.role !== 'assistant') {
      return;
    }
    const regex = /Observation:\s*(.+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(message.content)) !== null) {
      prompts.push(match[1].trim());
    }
  });
  return prompts;
}

function derivePreferredElementsFromQuery(query: string) {
  const normalized = query.toLowerCase();
  const elements: string[] = [];
  const add = (elementId: string) => {
    if (!elements.includes(elementId)) {
      elements.push(elementId);
    }
  };

  if (
    /hand|finger|point|gesture|raising|lift(ing)?|upward|pointing/i.test(
      normalized
    )
  ) {
    add('gesture_pointing_up');
  }
  if (
    /cup|hemlock|poison|drink|drinking|chalice|goblet|glass/i.test(normalized)
  ) {
    add('hemlock_exchange');
  }
  if (
    /companion|student|disciple|follower|friend|group|figures|people/i.test(
      normalized
    ) ||
    (/who/i.test(normalized) && /painting|scene|people|figures/i.test(normalized))
  ) {
    add('companions_row');
  }
  if (/plato|crito|simmias|cebes|xanthippe/i.test(normalized)) {
    add('companions_row');
  }
  if (/lyre|shackle|chain|object|floor|ground|corner/i.test(normalized)) {
    add('discarded_lyre');
  }
  if (
    /scene|painting|whole|entire|overall|everything|look around|take in/i.test(
      normalized
    )
  ) {
    add('overall_scan');
  }

  return elements;
}

function trimHistory(messages: ChatMessageInput[] = []) {
  const MAX_EXCHANGES = 6;
  const trimmed = [...messages];

  if (trimmed.length <= MAX_EXCHANGES * 2) {
    return trimmed;
  }

  return trimmed.slice(trimmed.length - MAX_EXCHANGES * 2);
}

function formatSnippets(snippets: KnowledgeSnippet[]) {
  if (snippets.length === 0) {
    return 'SNIPPETS\n- (none)';
  }

  const lines = snippets.map((snippet) => {
    const parts: string[] = [];
    parts.push(`- [S:${snippet.snippetId}] ${snippet.text}`);
    if (snippet.sourceTitle) {
      parts.push(` (${snippet.sourceTitle})`);
    }
    if (snippet.sectionHeading) {
      parts.push(` §${snippet.sectionHeading}`);
    }
    return parts.join('');
  });

  return ['SNIPPETS', ...lines].join('\n');
}

function formatCoreFacts(capsule: KnowledgeCapsule | null) {
  const facts = capsule?.core_facts;
  if (!facts || typeof facts !== 'object') {
    return 'CORE FACTS\n- title: The Death of Socrates\n- artist: Jacques-Louis David\n- date: 1787\n- medium: Oil on canvas';
  }

  const entries = Object.entries(facts);
  if (entries.length === 0) {
    return 'CORE FACTS\n- (missing core facts)';
  }

  const lines = entries.map(([key, value]) => {
    if (value == null) {
      return null;
    }
    if (typeof value === 'object') {
      if ('name' in (value as Record<string, unknown>)) {
        return `- ${key}: ${(value as { name?: string }).name ?? ''}`;
      }
      return `- ${key}: ${JSON.stringify(value)}`;
    }
    return `- ${key}: ${String(value)}`;
  });

  return ['CORE FACTS', ...lines.filter((line): line is string => Boolean(line))].join('\n');
}

function formatRelatedEntities(capsule: KnowledgeCapsule | null) {
  const entities = capsule?.related_entities;
  if (!entities || entities.length === 0) {
    return 'RELATED ENTITIES\n- (none recorded)';
  }

  const lines = entities.map((entity) => {
    const relation = entity.relation ? entity.relation.replace(/_/g, ' ') : 'related';
    return `- ${entity.label} (${relation})`;
  });

  return ['RELATED ENTITIES', ...lines].join('\n');
}

function extractCitationIds(content: string) {
  const ids = new Set<string>();
  const matcher = /\[S:([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

function buildOpenAIMessages(
  history: ChatMessageInput[],
  snippets: KnowledgeSnippet[],
  capsule: KnowledgeCapsule | null,
  retrievalLog: string[],
  options: {
    promptStrategy?: PromptStrategy;
    observationPrompt?: SelectedSlowLookingPrompt | null;
  } = {}
): OpenAIChatMessage[] {
  const retrievalSection = [
    'RETRIEVAL TASKS',
    ...(retrievalLog.length > 0
      ? retrievalLog
      : ['- default query (latest user message)']),
  ];

  const strategy = options.promptStrategy ?? 'FACT_FIRST';
  const instructions: string[] = [
    'Only the snippet IDs listed above are valid.',
    '1. List the snippet IDs you will use (comma separated).',
    '2. Provide the final answer with citations.',
  ];

  const focusDetail = options.observationPrompt?.focusDetail;
  const observationPreview = options.observationPrompt?.prompt;

  if (focusDetail) {
    instructions.splice(
      1,
      0,
      'Highlight the focus detail noted below within your factual answer using the appropriate citations.'
    );
  }

  instructions.push(
    'Do not invent or append any observation questions; the system will add them after your factual reply.'
  );

  const contextBlock = [
    retrievalSection.join('\n'),
    '',
    formatSnippets(snippets),
    '',
    formatCoreFacts(capsule),
    '',
    formatRelatedEntities(capsule),
    '',
    `PROMPT STRATEGY\n- ${strategy}`,
    focusDetail ? `\nFOCUS DETAIL\n- ${focusDetail}` : null,
    observationPreview
      ? `\nOBSERVATION PROMPT (system will ask the visitor)\n- ${observationPreview}`
      : null,
    '',
    ...instructions,
  ]
    .filter((section): section is string => section !== null)
    .join('\n');

  const base: OpenAIChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'assistant', content: contextBlock },
  ];

  const trimmedHistory = trimHistory(history);
  trimmedHistory.forEach((message) => {
    base.push({
      role: message.role,
      content: message.content,
    });
  });

  return base;
}

function filterSnippetsByCitation(
  snippets: KnowledgeSnippet[],
  citationIds: string[]
) {
  if (citationIds.length === 0) {
    return [];
  }
  const cited = new Set(citationIds);
  return snippets.filter((snippet) => cited.has(snippet.snippetId));
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

function collectStringLeaves(input: unknown, collector: Set<string>) {
  if (typeof input === 'string') {
    const normalized = input.trim();
    if (normalized) {
      collector.add(normalized);
    }
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((value) => collectStringLeaves(value, collector));
    return;
  }
  if (input && typeof input === 'object') {
    Object.values(input).forEach((value) => collectStringLeaves(value, collector));
  }
}

function sanitizePlannerQuery(
  query: string,
  fallback: string,
  rationale?: string
): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const strings = new Set<string>();
      collectStringLeaves(parsed, strings);
      if (strings.size > 0) {
        return Array.from(strings).join(' ');
      }
    } catch {
      // fall through to fallback handling
    }
    const rationaleText = rationale?.trim();
    if (rationaleText) {
      return rationaleText;
    }
    return fallback;
  }

  return trimmed;
}

async function executeRetrievalPlan(
  artifactId: string,
  latestUserQuery: string,
  plannedTasks: RetrievalTask[]
): Promise<{
  snippets: KnowledgeSnippet[];
  log: RetrievalLogEntry[];
}> {
  const snippetMap = new Map<string, KnowledgeSnippet>();
  const log: RetrievalLogEntry[] = [];

  const addSnippets = (
    snippets: KnowledgeSnippet[],
    entry: RetrievalLogEntry
  ) => {
    log.push(entry);
    snippets.forEach((snippet) => {
      const existing = snippetMap.get(snippet.snippetId);
      if (!existing || (snippet.score ?? 0) > (existing.score ?? 0)) {
        snippetMap.set(snippet.snippetId, snippet);
      }
    });
  };

  for (const task of plannedTasks) {
    const normalizedQuery = sanitizePlannerQuery(
      task.query,
      latestUserQuery,
      task.rationale
    );
    const taskSnippets = await retrieveKnowledgeSnippets({
      artifactId,
      query: normalizedQuery,
      size: 8,
    });
    addSnippets(taskSnippets, {
      query: normalizedQuery,
      hits: taskSnippets.length,
      source: 'planner',
      rationale: task.rationale,
      topSnippets: taskSnippets.slice(0, 3).map((snippet) => ({
        snippetId: snippet.snippetId,
        sourceTitle: snippet.sourceTitle,
      })),
    });
  }

  const plannerSnippets = Array.from(snippetMap.values());

  if (plannerSnippets.length < 4) {
    const fallbackSnippets = await retrieveKnowledgeSnippets({
      artifactId,
      query: latestUserQuery,
      size: 12,
    });
    addSnippets(fallbackSnippets, {
      query: latestUserQuery,
      hits: fallbackSnippets.length,
      source: 'fallback',
      topSnippets: fallbackSnippets.slice(0, 3).map((snippet) => ({
        snippetId: snippet.snippetId,
        sourceTitle: snippet.sourceTitle,
      })),
    });
  }

  const merged = Array.from(snippetMap.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 12);

  return { snippets: merged, log };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ChatRequestPayload;

    if (!payload.artifactId || payload.artifactId !== SUPPORTED_ARTIFACT_ID) {
      return NextResponse.json(
        { error: 'This chat prototype is currently limited to met_436105.' },
        { status: 400 }
      );
    }

    const messages = payload.messages ?? [];
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'At least one user message is required.' },
        { status: 400 }
      );
    }

    const latestUserMessage = findLatestUserMessage(messages);
    if (!latestUserMessage) {
      return NextResponse.json(
        { error: 'A user message is required to continue the conversation.' },
        { status: 400 }
      );
    }

    const fragmentReply = resolveFragmentResponse(latestUserMessage);
    if (fragmentReply) {
      return NextResponse.json({
        message: {
          role: 'assistant',
          content: fragmentReply,
        },
        snippets: [],
        retrievalLog: [
          {
            query: latestUserMessage,
            hits: 0,
            source: 'planner',
            rationale:
              'Fragment detected; offered clarifying prompt instead of retrieval.',
          },
        ],
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured.' },
        { status: 500 }
      );
    }

    const model =
      process.env.OPENAI_ARTWORK_MODEL?.trim() || 'gpt-5-mini';
    const fallbackModel =
      model !== 'gpt-4o-mini' ? 'gpt-4o-mini' : null;

    const capsule = await loadKnowledgeCapsule(payload.artifactId);
    const deflectionMessage = buildDeflectionMessage(capsule);
    const trimmedHistory = trimHistory(messages);
    const plannerContext =
      trimmedHistory.length > 0
        ? trimmedHistory.slice(0, -1)
        : [];

    const plannerPlan = await planRetrievalTasks({
      artifactId: payload.artifactId,
      apiKey,
      model,
      userQuery: latestUserMessage,
      recentMessages: plannerContext,
      capsule,
      maxTasks: 3,
    });

    const defaultStrategy: PromptStrategy = FACT_QUERY_PATTERN.test(
      latestUserMessage
    )
      ? 'FACT_FIRST'
      : 'OBSERVATION_FIRST';

    let promptStrategy: PromptStrategy =
      plannerPlan.promptStrategy ?? defaultStrategy;

    const turnsSinceOptOut = turnsSinceLastOptOut(messages);
    const userRequestedFactsOnly = turnsSinceOptOut === 0;
    const suppressObservation =
      turnsSinceOptOut < OBSERVATION_SUPPRESSION_WINDOW &&
      !userRequestedObservationResume(latestUserMessage) &&
      !OBSERVATION_REQUEST_PATTERN.test(latestUserMessage);

    if (userRequestedFactsOnly || suppressObservation) {
      promptStrategy = 'FACT_FIRST';
    }

    if (promptStrategy === 'DEFLECT') {
      return NextResponse.json({
        message: {
          role: 'assistant',
          content: deflectionMessage,
        },
        snippets: [],
        retrievalLog: [
          {
            query: latestUserMessage,
            hits: 0,
            source: 'planner',
            rationale: 'Request deemed outside capsule scope.',
          },
        ],
      });
    }

    const preferredElements =
      derivePreferredElementsFromQuery(latestUserMessage);
    const recentObservationPrompts = extractObservationPrompts(trimmedHistory);
    const recentPromptTexts = recentObservationPrompts.slice(-8);
    const artifactIdSafe = payload.artifactId ?? SUPPORTED_ARTIFACT_ID;
    const recentElementIds = recentPromptTexts
      .map((prompt) => findElementIdForPrompt(artifactIdSafe, prompt))
      .filter((value): value is string => Boolean(value));
    const excludeElements = recentElementIds
      .filter((elementId) => !preferredElements.includes(elementId))
      .slice(-3);

    const { snippets, log } = await executeRetrievalPlan(
      payload.artifactId,
      latestUserMessage,
      plannerPlan.tasks ?? []
    );

    if (!snippets.length) {
      return NextResponse.json({
        message: {
          role: 'assistant',
          content: deflectionMessage,
        },
        snippets: [],
        retrievalLog: log,
      });
    }

    const allowObservation =
      !suppressObservation &&
      !userRequestedFactsOnly &&
      !userOptedOutOfObservation(messages);

    const observationPrompt =
      allowObservation || promptStrategy === 'OBSERVATION_FIRST'
        ? selectSlowLookingPrompt({
            artifactId: payload.artifactId,
            availableSnippetIds: snippets.map((snippet) => snippet.snippetId),
            targetElements: plannerPlan.targetElements,
            preferredElements,
            excludeElements,
            recentPrompts: recentPromptTexts,
          })
        : null;

    if (promptStrategy === 'OBSERVATION_FIRST' && !observationPrompt) {
      promptStrategy = 'FACT_FIRST';
    }

    const retrievalLogLines = log.map((entry) => {
      const prefix = entry.source === 'planner' ? 'planner' : 'fallback';
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
      const topInfo = topSnippets ? ` [top: ${topSnippets}]` : '';
      const base = `- ${prefix} query "${entry.query}" → ${entry.hits} snippet(s)${topInfo}`;
      if (entry.rationale) {
        return `${base} (because ${entry.rationale})`;
      }
      return base;
    });

    async function callOpenAIChat(modelName: string) {
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.1,
          max_tokens: 320,
          messages: buildOpenAIMessages(
            trimmedHistory,
            snippets,
            capsule,
            retrievalLogLines,
            {
              promptStrategy,
              observationPrompt,
            }
          ),
        }),
      });
    }

    const orderedModels = [model, fallbackModel].filter(
      (candidate): candidate is string => Boolean(candidate)
    );

    let openAiResponse: Response | null = null;
    let lastErrorPayload: unknown = null;

    for (const candidate of orderedModels) {
      const response = await callOpenAIChat(candidate);
      if (response.ok) {
        openAiResponse = response;
        break;
      }
      try {
        lastErrorPayload = await response.json();
      } catch {
        try {
          lastErrorPayload = await response.text();
        } catch {
          lastErrorPayload = null;
        }
      }
      console.warn('[artwork-chat] model request failed', candidate, {
        status: response.status,
        error: lastErrorPayload,
      });
    }

    if (!openAiResponse) {
      return NextResponse.json(
        { error: 'Model request failed. Please try again.' },
        { status: 502 }
      );
    }

    const completion = (await openAiResponse.json()) as OpenAIChatCompletion;
    const choice = completion.choices?.[0];
    const content = choice?.message?.content?.trim();

    if (!content) {
      return NextResponse.json(
        { error: 'Model returned an empty response.' },
        { status: 502 }
      );
    }

    const citations = extractCitationIds(content);
    const filteredSnippets = filterSnippetsByCitation(snippets, citations);
    const allowedSnippetIds = new Set(snippets.map((snippet) => snippet.snippetId));
    const invalidCitations = citations.filter(
      (citationId) => !allowedSnippetIds.has(citationId)
    );

    if (invalidCitations.length > 0 || filteredSnippets.length === 0) {
      console.warn('[artwork-chat] invalid or missing citations', {
        citations,
        invalidCitations,
        available: Array.from(allowedSnippetIds),
      });

      return NextResponse.json({
        message: {
          role: 'assistant',
          content: deflectionMessage,
        },
        snippets: [],
        retrievalLog: log,
      });
    }

    let assistantMessage = isUnsafeContent(content)
      ? deflectionMessage
      : stripClosingPhrases(content);

    if (
      assistantMessage !== deflectionMessage &&
      observationPrompt &&
      !assistantMessage.includes('Observation:') &&
      (allowObservation || promptStrategy === 'OBSERVATION_FIRST')
    ) {
      const trimmedFacts = assistantMessage.trimEnd();
      const promptLine = `Observation: ${observationPrompt.prompt}`;
      assistantMessage =
        trimmedFacts.length > 0
          ? `${trimmedFacts}\n\n${promptLine}`
          : promptLine;
    }

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: assistantMessage,
      },
      snippets: filteredSnippets,
      retrievalLog: log,
    });
  } catch (error) {
    console.error('[artwork-chat] unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while processing chat.' },
      { status: 500 }
    );
  }
}
