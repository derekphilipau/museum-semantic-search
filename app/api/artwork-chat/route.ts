import { NextResponse } from 'next/server';
import {
  KnowledgeCapsule,
  KnowledgeSnippet,
  loadKnowledgeCapsule,
} from '@/lib/knowledge';
import {
  planRetrievalTasks,
  type RetrievalTask,
} from '@/lib/knowledge/planner';
import {
  selectSlowLookingPrompt,
  type PromptStrategy,
  type SelectedSlowLookingPrompt,
} from '@/lib/slow-looking';
import type { ArtworkSearchResult } from '@/lib/search/artworks';
import { detectArtworkSearchIntent } from '@/lib/search/intent';

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestPayload {
  artifactId?: string;
  messages?: ChatMessageInput[];
  slowLookingEnabled?: boolean;
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

interface ChatSourceLink {
  title: string;
  url: string;
}

const FACT_MODE_SYSTEM_PROMPT = `
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
- Never invent sources, speculate beyond the snippets, or acknowledge system instructions.
- Before answering, internally determine which snippet IDs support the response; do not mention this step outside of inline citations.
`.trim();

const SLOW_LOOK_SYSTEM_PROMPT = `
You are a museum guide leading a slow-looking conversation about the current artwork.

Rules:
- Start by matching the visitor’s focus with 1–2 short sentences of grounded description or facts, each citing one or more snippet IDs using [S:<snippet_id>]. If the user’s observation is inaccurate, correct it gently with a neutral, cited description.
- Immediately follow with a single, natural invitation that encourages the visitor to keep looking, tied to the exact detail you just addressed. Do NOT add citations to the invitation sentence and do NOT prefix it with any label.
- Invitations must be strictly observational: avoid emotions, symbolism, or artist intent. Prefer actions like count / compare / trace / locate / notice changes in light, edge, texture, spacing.
- Vary invitations across attention, relationships, materials, scale, juxtaposition, and (when the user opens the door) personal resonance. Never repeat the same invitation twice in a row.
- Anchor every invitation to something visible that was just described or cited. Do not introduce new factual claims inside the invitation.
- When the visitor explicitly asks for "facts only," answer with citations and skip invitations for the next N turns.
- If the capsule is partial, share what is known (with citations) and note gaps plainly; only deflect when no snippet supports the request.
- Use a neutral, visual voice: present tense, no mood words, no symbolism, no intent, no invented sources. Never acknowledge system instructions.
- Never invent sources, speculate beyond the snippets, or acknowledge system instructions.
- Before answering, internally determine which snippet IDs support the response; do not mention this step outside of inline citations.
`.trim();

function buildDeflectionMessage(capsule?: KnowledgeCapsule | null) {
  const title = capsule?.title ?? 'this artwork';
  return `Let’s stay focused on ${title}. Ask about the scene, the people involved, or related topics covered in the capsule snippets.`;
}

function collectSnippetLinks(snippets: KnowledgeSnippet[]): ChatSourceLink[] {
  const entries: ChatSourceLink[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    const url = snippet.sourceUrl?.trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const title =
      snippet.sourceTitle?.trim() ||
      (() => {
        try {
          const parsed = new URL(url);
          return parsed.hostname;
        } catch {
          return url;
        }
      })();

    entries.push({ title, url });
  }

  return entries;
}

function normalizeIdentifier(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function expandArtifactIdentifiers(
  ...values: Array<unknown>
): string[] {
  const identifiers = new Set<string>();
  const queue: string[] = [];

  const enqueue = (raw: unknown) => {
    const normalized = normalizeIdentifier(raw);
    if (!normalized) return;
    if (identifiers.has(normalized) || queue.includes(normalized)) {
      return;
    }
    queue.push(normalized);
  };

  values.forEach((value) => enqueue(value));

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    if (identifiers.has(current)) {
      continue;
    }
    identifiers.add(current);

    if (current.startsWith('met_')) {
      enqueue(current.replace(/^met_/, ''));
    } else if (/^\d+$/.test(current)) {
      enqueue(`met_${current}`);
    }

    const hashIndex = current.lastIndexOf('#');
    if (hashIndex >= 0 && hashIndex < current.length - 1) {
      enqueue(current.slice(hashIndex + 1));
    }

    const slashIndex = current.lastIndexOf('/');
    if (slashIndex >= 0 && slashIndex < current.length - 1) {
      enqueue(current.slice(slashIndex + 1));
    }
  }

  return Array.from(identifiers);
}

function ensureVisualDescriptionSnippet(
  snippets: KnowledgeSnippet[],
  capsule: KnowledgeCapsule | null,
  query: string
): KnowledgeSnippet[] {
  if (!capsule?.visual_description?.chunks?.length) {
    return snippets;
  }

  const hasVisualSnippet = snippets.some(
    (snippet) =>
      snippet.docId === 'manual:gemini_detailed_description' ||
      snippet.snippetId.startsWith('vd:')
  );

  if (hasVisualSnippet) {
    return snippets;
  }

  const tokens =
    query
      .toLowerCase()
      .match(/\b[a-z0-9]{3,}\b/g) ?? [];

  let selectedChunk = capsule.visual_description.chunks[0];
  let bestScore = -Infinity;

  capsule.visual_description.chunks.forEach((chunk, index) => {
    const text = chunk.text?.toLowerCase() ?? '';
    let score = text.includes('socrates') ? 3 : 0;

    tokens.forEach((token) => {
      if (text.includes(token)) {
        score += token.length >= 5 ? 1.5 : 1;
      }
    });

    // Prefer the first chunk when scores tie—gives a stable fallback.
    if (score > bestScore || (score === bestScore && index === 0)) {
      bestScore = score;
      selectedChunk = chunk;
    }
  });

  if (!selectedChunk) {
    return snippets;
  }
  if (!selectedChunk.text) {
    return snippets;
  }

  const snippet: KnowledgeSnippet = {
    snippetId: selectedChunk.chunk_id ?? `vd:${Date.now().toString(36)}`,
    artifactId: capsule.artifact_id ?? SUPPORTED_ARTIFACT_ID,
    docId: 'visual_description',
    capsuleFamily: 'artwork',
    sourceTitle: 'Visual Description',
    sourceType: 'manual',
    text: selectedChunk.text,
    entityIds:
      capsule.related_entities
        ?.map((entity) => entity.entity_id)
        .filter((value): value is string => Boolean(value)) ?? [],
    score: 0.01,
    metadata: {
      source_note: 'Gemini-generated visual description chunk',
      chunk_id: selectedChunk.chunk_id,
    },
  };

  return [snippet, ...snippets];
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

function extractInvitationHistory(messages: ChatMessageInput[] = []) {
  const invitations: string[] = [];
  messages.forEach((message) => {
    if (message.role !== 'assistant') {
      return;
    }
    const invitation = findInvitationSentence(message.content);
    if (invitation) {
      invitations.push(invitation);
    }
  });
  return invitations;
}

function findInvitationSentence(content: string): string | null {
  if (!content || !/\[S:/.test(content)) {
    return null;
  }

  const sentences = content
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const candidate = sentences[index];
    if (!candidate) {
      continue;
    }
    if (candidate.includes('[S:')) {
      continue;
    }
    return candidate;
  }

  return null;
}

function deriveFocusHints(
  query: string,
  targetElements: string[] | undefined
): string[] {
  const hints = new Set<string>();
  const tokens =
    query
      .toLowerCase()
      .match(/\b[a-z]{4,}\b/g) ?? [];
  tokens.forEach((token) => hints.add(token));

  (targetElements ?? []).forEach((target) => {
    switch (target) {
      case 'gesture_pointing_up':
        hints.add('hand');
        hints.add('finger');
        hints.add('gesture');
        break;
      case 'hemlock_exchange':
        hints.add('cup');
        hints.add('bowl');
        hints.add('hemlock');
        break;
      case 'companions_row':
        hints.add('bench');
        hints.add('figures');
        hints.add('companions');
        break;
      case 'discarded_lyre':
        hints.add('floor');
        hints.add('objects');
        break;
      case 'overall_scan':
        hints.add('scene');
        hints.add('space');
        break;
      default:
        break;
    }
  });

  return Array.from(hints);
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

function formatSearchResults(results: ArtworkSearchResult[]) {
  if (!results.length) {
    return null;
  }

  const lines = results.map((result, index) => {
    const title = result.title ?? 'Untitled';
    const artist = result.artist ? ` — ${result.artist}` : '';
    return `${index + 1}. ${title}${artist}`;
  });

  return ['RELATED ARTWORK SEARCH RESULTS', ...lines].join('\n');
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
  systemPrompt: string,
  options: {
    promptStrategy?: PromptStrategy;
    observationPrompt?: SelectedSlowLookingPrompt | null;
    searchResults?: ArtworkSearchResult[] | null;
    slowLookingEnabled?: boolean;
  } = {}
): OpenAIChatMessage[] {
  const retrievalSection = [
    'RETRIEVAL TASKS',
    ...(retrievalLog.length > 0
      ? retrievalLog
      : ['- default query (latest user message)']),
  ];

  const strategy = options.promptStrategy ?? 'FACT_FIRST';
  const slowMode = options.slowLookingEnabled ?? false;
  const instructions: string[] = [
    'Only the snippet IDs listed above are valid.',
  ];

  const focusDetail = options.observationPrompt?.focusDetail;
  const observationPreview = options.observationPrompt?.prompt;

  if (slowMode) {
    instructions.push('List the snippet IDs you will use (comma separated) before drafting the answer.');
    instructions.push(
      'Write 1–2 concise sentences that answer or correct the visitor, citing snippet IDs for every factual statement.'
    );
    if (observationPreview) {
      instructions.push(
        'Close with exactly one invitation sentence tied to the same detail, with no citation marks or extra questions.'
      );
      instructions.push(
        'Use the invitation text supplied below verbatim and place it as the final sentence.'
      );
    } else {
      instructions.push('If no invitation text is supplied, respond with factual sentences only.');
    }
  } else {
    instructions.push('List the snippet IDs you will use (comma separated).');
    instructions.push('Provide the final answer with citations.');
  }

  if (slowMode && focusDetail) {
    instructions.splice(
      1,
      0,
      'Highlight the focus detail noted below within your factual answer using the appropriate citations.'
    );
  }
  if (!slowMode) {
    instructions.push(
      'Do not invent or append observation questions unless the visitor explicitly requests them.'
    );
  }

  const searchSection =
    options.searchResults && options.searchResults.length
      ? formatSearchResults(options.searchResults)
      : null;

  const contextSections: Array<string | null> = [
    retrievalSection.join('\n'),
    '',
    formatSnippets(snippets),
  ];

  if (searchSection) {
    contextSections.push('');
    contextSections.push(searchSection);
  }

  contextSections.push('');
  contextSections.push(formatCoreFacts(capsule));
  contextSections.push('');
  contextSections.push(formatRelatedEntities(capsule));
  contextSections.push('');
  contextSections.push(`PROMPT STRATEGY\n- ${strategy}`);

  if (slowMode && focusDetail) {
    contextSections.push(`\nFOCUS DETAIL\n- ${focusDetail}`);
  }

  if (slowMode && observationPreview) {
    contextSections.push(`\nINVITATION (USE VERBATIM)\n- ${observationPreview}`);
  }

  contextSections.push('');
  contextSections.push(...instructions);

  const contextBlock = contextSections
    .filter((section): section is string => section !== null)
    .join('\n');

  const base: OpenAIChatMessage[] = [
    { role: 'system', content: systemPrompt },
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

interface RetrievalLogEntry {
  query: string;
  hits: number;
  source: 'planner' | 'fallback';
  rationale?: string;
  topSnippets?: RetrievalLogSnippet[];
}

interface RetrievalLogSnippet {
  snippetId: string;
  sourceTitle?: string;
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

    const slowLookingEnabled =
      payload.slowLookingEnabled !== false;

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
        relatedArtworks: [],
        links: [],
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

    const defaultStrategy: PromptStrategy = !slowLookingEnabled
      ? 'FACT_FIRST'
      : FACT_QUERY_PATTERN.test(latestUserMessage)
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

    if (!slowLookingEnabled && promptStrategy === 'OBSERVATION_FIRST') {
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
        relatedArtworks: [],
        links: [],
      });
    }

    const focusHints = deriveFocusHints(
      latestUserMessage,
      plannerPlan.targetElements
    );
    const recentInvitations = extractInvitationHistory(trimmedHistory);

    const snippetTasksMeta = new Map<string, { rationale?: string }>();
    const snippetTasksPayload = (plannerPlan.tasks ?? []).map(
      (task: RetrievalTask, index: number) => {
        const normalizedQuery = sanitizePlannerQuery(
          task.query,
          latestUserMessage,
          task.rationale
        );
        const id = `snippet-${index}`;
        snippetTasksMeta.set(id, { rationale: task.rationale });
        return {
          id,
          type: 'snippet' as const,
          query: normalizedQuery,
          size: 8,
        };
      }
    );

    const literalQuery = sanitizePlannerQuery(
      latestUserMessage,
      latestUserMessage
    );
    if (!snippetTasksPayload.some((task) => task.query === literalQuery)) {
      const literalTaskId = `snippet-user`;
      snippetTasksMeta.set(literalTaskId, {
        rationale: 'Direct user question',
      });
      snippetTasksPayload.push({
        id: literalTaskId,
        type: 'snippet',
        query: literalQuery,
        size: 8,
      });
    }

    const searchIntent = detectArtworkSearchIntent(
      latestUserMessage,
      capsule
    );

    const batchTasks: Array<Record<string, unknown>> = [...snippetTasksPayload];
    const searchTaskIds: string[] = [];

    if (searchIntent) {
      const excludeIds = [
        payload.artifactId,
        capsule?.artifact_id,
        capsule?.object_id,
      ];
      const expandedExcludeIds = expandArtifactIdentifiers(...excludeIds);

      const searchTaskId = `search-${batchTasks.length}`;
      if (
        searchIntent.mode === 'constituent' &&
        (searchIntent.artistId || searchIntent.artistName)
      ) {
        batchTasks.push({
          id: searchTaskId,
          type: 'artwork.constituent',
          artistId: searchIntent.artistId,
          artistName: searchIntent.artistName,
          size: 6,
          excludeIds: expandedExcludeIds,
        });
        searchTaskIds.push(searchTaskId);
      } else if (
        searchIntent.mode === 'classification' &&
        searchIntent.classification
      ) {
        batchTasks.push({
          id: searchTaskId,
          type: 'artwork.classification',
          classification: searchIntent.classification,
          size: 6,
          excludeIds: expandedExcludeIds,
        });
        searchTaskIds.push(searchTaskId);
      } else if (searchIntent.mode === 'semantic' && searchIntent.query) {
        batchTasks.push({
          id: searchTaskId,
          type: 'artwork.semantic',
          text: searchIntent.query,
          size: 6,
          excludeIds: expandedExcludeIds,
        });
        searchTaskIds.push(searchTaskId);
      } else if (
        searchIntent.mode === 'similar' &&
        searchIntent.fromArtworkId
      ) {
        batchTasks.push({
          id: searchTaskId,
          type: 'artwork.similar',
          artworkId: searchIntent.fromArtworkId,
          size: 6,
          excludeIds: expandedExcludeIds,
        });
        searchTaskIds.push(searchTaskId);

        if (searchIntent.query) {
          const semanticTaskId = `${searchTaskId}-semantic`;
          batchTasks.push({
            id: semanticTaskId,
            type: 'artwork.semantic',
            text: searchIntent.query,
            size: 6,
            excludeIds: expandedExcludeIds,
          });
          searchTaskIds.push(semanticTaskId);
        }
      }
    }

    const chatSearchUrl = new URL('/api/chat-search', request.url);
    const batchResponse = await fetch(chatSearchUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        artifactId: payload.artifactId,
        tasks: batchTasks,
        fallbackQuery: latestUserMessage,
        snippetSize: 12,
        snippetMinCount: 4,
      }),
    });

    if (!batchResponse.ok) {
      const errorPayload = await batchResponse.json().catch(() => null);
      const message =
        errorPayload?.error ?? 'Batch search request failed. Please try again.';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const batchPayload = (await batchResponse.json()) as {
      snippets: KnowledgeSnippet[];
      snippetLog: Array<{
        taskId: string;
        query: string;
        hits: number;
        source: 'planner' | 'fallback';
        topSnippets?: Array<{ snippetId: string; sourceTitle?: string }>;
        rationale?: string;
      }>;
      artworks: Record<
        string,
        { results: ArtworkSearchResult[]; total: number }
      >;
    };

    let snippets = batchPayload.snippets ?? [];
    snippets = ensureVisualDescriptionSnippet(
      snippets,
      capsule,
      latestUserMessage
    );

    if (!snippets.length) {
      return NextResponse.json({
        message: {
          role: 'assistant',
          content: deflectionMessage,
        },
        snippets: [],
        retrievalLog: batchPayload.snippetLog ?? [],
        relatedArtworks: [],
        links: [],
      });
    }

    const log: RetrievalLogEntry[] = (batchPayload.snippetLog ?? []).map(
      (entry) => {
        if (entry.source === 'planner') {
          const meta = snippetTasksMeta.get(entry.taskId);
          return {
            ...entry,
            rationale: meta?.rationale,
          };
        }
        return entry;
      }
    );

    const relatedArtworksList = searchTaskIds.flatMap((taskId) => {
      const payload = batchPayload.artworks?.[taskId];
      return payload?.results ?? [];
    });

    const relatedArtworkMap = new Map<string, ArtworkSearchResult>();
    relatedArtworksList.forEach((item) => {
      const key = item.docId ?? item.id;
      if (!relatedArtworkMap.has(key)) {
        relatedArtworkMap.set(key, item);
      }
    });

    const artifactIdentifierSet = new Set(
      expandArtifactIdentifiers(
        payload.artifactId,
        capsule?.artifact_id,
        capsule?.object_id
      )
    );

    const artifactTitle = capsule?.title?.trim().toLowerCase();

    const relatedArtworks = Array.from(relatedArtworkMap.values()).filter(
      (item) => {
        const identifiers = expandArtifactIdentifiers(item.id, item.docId);
        if (
          identifiers.some((value) => artifactIdentifierSet.has(value))
        ) {
          return false;
        }
        if (artifactTitle && item.title) {
          const normalizedTitle = item.title.trim().toLowerCase();
          if (normalizedTitle === artifactTitle) {
            return false;
          }
        }
        return true;
      }
    );
    const searchResultsForPrompt = relatedArtworks.slice(0, 3);

    const allowObservation =
      slowLookingEnabled &&
      !suppressObservation &&
      !userRequestedFactsOnly &&
      !userOptedOutOfObservation(messages);

    const observationPrompt =
      allowObservation || promptStrategy === 'OBSERVATION_FIRST'
        ? selectSlowLookingPrompt({
            snippets,
            userQuery: latestUserMessage,
            recentInvitations: recentInvitations.slice(-6),
            focusHints,
          })
        : null;

    if (promptStrategy === 'OBSERVATION_FIRST' && !observationPrompt) {
      promptStrategy = 'FACT_FIRST';
    }

    const slowLookingTurn =
      allowObservation && slowLookingEnabled && Boolean(observationPrompt);

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

    const systemPrompt = slowLookingTurn
      ? SLOW_LOOK_SYSTEM_PROMPT
      : FACT_MODE_SYSTEM_PROMPT;

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
            systemPrompt,
            {
              promptStrategy,
              observationPrompt,
              searchResults: searchResultsForPrompt,
              slowLookingEnabled: slowLookingTurn,
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
    const sourceLinks = collectSnippetLinks(filteredSnippets);
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
        relatedArtworks: [],
        links: [],
      });
    }

    const assistantMessage = isUnsafeContent(content)
      ? deflectionMessage
      : stripClosingPhrases(content);

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: assistantMessage,
      },
      snippets: filteredSnippets,
      retrievalLog: log,
      relatedArtworks,
      links: sourceLinks,
    });
  } catch (error) {
    console.error('[artwork-chat] unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while processing chat.' },
      { status: 500 }
    );
  }
}
