import type { KnowledgeSnippet } from '@/lib/knowledge';

export type PromptStrategy = 'OBSERVATION_FIRST' | 'FACT_FIRST' | 'DEFLECT';

export interface SelectedSlowLookingPrompt {
  focusDetail: string;
  prompt: string;
  snippetIds: string[];
}

interface SelectPromptOptions {
  snippets: KnowledgeSnippet[];
  userQuery: string;
  recentInvitations?: string[];
  focusHints?: string[];
}

interface InvitationRule {
  keywords: string[];
  build: (keyword: string) => string;
}

const FALLBACK_INVITATIONS = [
  'Take another slow look at this area—what edges or textures stand out to you now?',
  'Let your eye move slowly across this spot—what changes do you notice as you shift from one side to the other?',
  'Stay with this detail for a moment—what shapes or lines reveal themselves as you keep looking?',
];

const INVITATION_RULES: InvitationRule[] = [
  {
    keywords: ['hand', 'hands', 'finger', 'fingers', 'arm', 'arms'],
    build: (keyword) => {
      const plural = isPlural(keyword);
      const subject = plural ? keyword : `the ${keyword}`;
      const pronoun = plural ? 'them' : 'it';
      return `Trace the line of ${subject} you just read about—what shifts in light or edge do you notice as ${pronoun} moves?`;
    },
  },
  {
    keywords: ['cup', 'bowl', 'chalice', 'goblet'],
    build: (keyword) =>
      `Look closely at the ${keyword} between the figures—how do its edges or brightness compare to nearby surfaces?`,
  },
  {
    keywords: ['bench', 'row', 'line', 'frieze'],
    build: (keyword) =>
      `Scan along that ${keyword}—how many shifts in posture or spacing can you spot as you move across it?`,
  },
  {
    keywords: ['robe', 'robes', 'cloth', 'cloths', 'drape', 'drapery', 'fabric', 'fabrics'],
    build: (keyword) => {
      const subject = isPlural(keyword) ? keyword : `the ${keyword}`;
      return `Follow the folds of ${subject}—where do they bunch up versus fall smoothly?`;
    },
  },
  {
    keywords: ['door', 'doors', 'arch', 'archway', 'archways', 'wall', 'walls', 'column', 'columns', 'stone', 'stones'],
    build: (keyword) => {
      const subject = isPlural(keyword) ? keyword : `the ${keyword}`;
      return `Trace the outline of ${subject}—what geometric angles or textures stand out as you follow it?`;
    },
  },
  {
    keywords: ['light', 'shadow', 'shadows', 'bright', 'dark'],
    build: (_keyword) => {
      void _keyword;
      return `Compare the light and shadow in that passage—where do you notice the sharpest shift?`;
    },
  },
  {
    keywords: ['face', 'faces', 'head', 'heads', 'eyes', 'gaze'],
    build: (keyword) => {
      const focus = keyword === 'face' ? 'faces' : keyword;
      return `Count the ${focus} gathered there—how many directions are they turned?`;
    },
  },
  {
    keywords: ['foot', 'feet', 'sandals'],
    build: (keyword) => {
      const subject = isPlural(keyword) ? keyword : `the ${keyword}`;
      return `Start at ${subject} mentioned there—how does the ground or support beneath change as you look nearby?`;
    },
  },
  {
    keywords: ['scroll', 'scrolls', 'tablet', 'tablets', 'book', 'books', 'paper', 'papers'],
    build: (keyword) => {
      const subject = isPlural(keyword) ? keyword : `the ${keyword}`;
      return `Take another look at ${subject}—what textures or markings can you pick out?`;
    },
  },
];

export function selectSlowLookingPrompt({
  snippets,
  userQuery,
  recentInvitations = [],
  focusHints = [],
}: SelectPromptOptions): SelectedSlowLookingPrompt | null {
  if (!snippets || snippets.length === 0) {
    return null;
  }

  const hints = buildHints(userQuery, focusHints);
  const scored = snippets
    .filter((snippet) => typeof snippet.text === 'string' && snippet.text.trim().length > 0)
    .map((snippet) => ({
      snippet,
      score: scoreSnippet(snippet, hints),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.find((entry) => entry.score > Number.NEGATIVE_INFINITY);
  if (!top) {
    return null;
  }

  const focusDetail = buildFocusDetail(top.snippet);
  if (!focusDetail) {
    return null;
  }

  const invitation = buildInvitation(top.snippet.text ?? '', recentInvitations);
  if (!invitation) {
    return null;
  }

  return {
    focusDetail,
    prompt: invitation,
    snippetIds: [top.snippet.snippetId],
  };
}

export function formatSlowLookingElementsForPlanner(): string {
  return 'dynamic — derive focus from retrieved visual-description snippets (gestures, hands, cup exchange, bench arrangement, light, textures).';
}

function scoreSnippet(snippet: KnowledgeSnippet, hints: string[]): number {
  const text = (snippet.text ?? '').toLowerCase();
  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (snippet.docId?.includes('visual_description') || snippet.docId === 'manual:gemini_detailed_description') {
    score += 6;
  }

  hints.forEach((hint) => {
    if (text.includes(hint)) {
      score += hint.length >= 5 ? 3 : 2;
    }
  });

  // Reward varied detail markers to avoid repetitive focus.
  if (/\bhand|finger|cup|bench|figure|fold|shadow|light\b/.test(text)) {
    score += 1;
  }

  // Longer descriptive snippets provide better guidance.
  score += Math.min((snippet.text?.length ?? 0) / 160, 2);

  return score;
}

function buildFocusDetail(snippet: KnowledgeSnippet): string | null {
  const text = snippet.text?.trim();
  if (!text) {
    return null;
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return null;
  }

  let result = '';
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length > 220) {
      break;
    }
    result = candidate;
  }

  if (!result) {
    result = sentences[0];
  }

  const trimmed = result.trim();
  const ending = /[.!?"]$/.test(trimmed) ? '' : '.';
  return `${trimmed}${ending} [S:${snippet.snippetId}]`;
}

function buildInvitation(snippetText: string, recentInvitations: string[]): string | null {
  const normalized = snippetText.toLowerCase();
  const seen = new Set(recentInvitations ?? []);

  for (const rule of INVITATION_RULES) {
    const keyword = rule.keywords.find((word) => normalized.includes(word));
    if (!keyword) {
      continue;
    }
    const invitation = rule.build(keyword);
    if (invitation && !seen.has(invitation)) {
      return invitation;
    }
  }

  for (const option of FALLBACK_INVITATIONS) {
    if (!seen.has(option)) {
      return option;
    }
  }

  return FALLBACK_INVITATIONS[0] ?? null;
}

function buildHints(userQuery: string, focusHints: string[]): string[] {
  const hints = new Set<string>();
  const tokens = userQuery
    .toLowerCase()
    .match(/\b[a-z]{4,}\b/g);

  tokens?.forEach((token) => hints.add(token));
  focusHints.forEach((hint) => {
    const normalized = hint.trim().toLowerCase();
    if (normalized) {
      hints.add(normalized);
    }
  });

  return Array.from(hints);
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isPlural(word: string): boolean {
  return /\b\w+s\b/.test(word) && !word.endsWith('ss');
}
