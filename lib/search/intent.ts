import type { KnowledgeCapsule } from '@/lib/knowledge/capsule';

export type ArtworkSearchMode =
  | 'constituent'
  | 'classification'
  | 'semantic'
  | 'similar';

export interface ArtworkSearchIntent {
  mode: ArtworkSearchMode;
  reason: string;
  fromArtworkId?: string;
  artistId?: string;
  artistName?: string;
  classification?: string;
  query?: string;
}

const SUBJECT_VERBS = ['with', 'featuring', 'including', 'about', 'depicting', 'showing', 'of'];
const SEARCH_TRIGGERS = [
  'other',
  'more',
  'similar',
  'another',
  'additional',
  'show me',
  'find',
  'recommend',
  'suggest',
];
const ARTWORK_NOUNS = ['painting', 'paintings', 'artwork', 'artworks', 'work', 'works', 'pieces'];

function containsSearchTrigger(text: string): boolean {
  return SEARCH_TRIGGERS.some((trigger) => text.includes(trigger));
}

function containsArtworkNoun(text: string): boolean {
  return ARTWORK_NOUNS.some((noun) => text.includes(noun));
}

function extractSubjectPhrase(message: string): string | null {
  for (const verb of SUBJECT_VERBS) {
    const pattern = new RegExp(`${verb}\\s+([^?.!]+)`, 'i');
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function matchRelatedEntity(
  message: string,
  capsule?: KnowledgeCapsule | null
): string | null {
  if (!capsule?.related_entities?.length) {
    return null;
  }

  const lower = message.toLowerCase();
  let bestMatch: string | null = null;

  capsule.related_entities.forEach((entity) => {
    const label = entity.label.toLowerCase();
    if (lower.includes(label)) {
      if (!bestMatch || label.length > bestMatch.length) {
        bestMatch = entity.label;
      }
    }
  });

  return bestMatch;
}

export function detectArtworkSearchIntent(
  message: string,
  capsule?: KnowledgeCapsule | null
): ArtworkSearchIntent | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const hasTrigger = containsSearchTrigger(normalized);
  const similarTriggers = [
    /similar to (this|the painting)/i,
    /paintings similar to/i,
    /\bpaintings like this\b/i,
    /\bworks like this\b/i,
    /\bpaintings like it\b/i,
    /\bworks like it\b/i,
    /\bmore like this\b/i,
    /\bmore like it\b/i,
  ];
  const matchesSimilar = similarTriggers.some((pattern) => pattern.test(message));
  const wantsSimilar =
    matchesSimilar ||
    /\blike (it|this)\b/i.test(normalized) ||
    /\bsimilar work\b/.test(normalized);
  const referencesArtworks = containsArtworkNoun(normalized);

  if (!(hasTrigger || matchesSimilar) || !referencesArtworks) {
    return null;
  }

  const coreArtistName =
    typeof capsule?.core_facts?.artist === 'object' &&
    capsule?.core_facts?.artist &&
    typeof (capsule.core_facts.artist as Record<string, unknown>).name ===
      'string'
      ? ((capsule.core_facts.artist as Record<string, unknown>).name as string)
      : undefined;

  const capsuleArtworkId = capsule?.artifact_id;

  // Requests like "other paintings by this artist"
  if (
    normalized.includes('by this artist') ||
    normalized.includes('by the same artist') ||
    normalized.includes('by this painter')
  ) {
    if (coreArtistName) {
      return {
        mode: 'constituent',
        reason: 'User asked for additional works by the current artist.',
        fromArtworkId: capsuleArtworkId ?? undefined,
        artistName: coreArtistName,
      };
    }
  }

  if (coreArtistName) {
    const artistLower = coreArtistName.toLowerCase();
    if (normalized.includes(`by ${artistLower}`)) {
      return {
        mode: 'constituent',
        reason: `User mentioned artist ${coreArtistName}.`,
        artistName: coreArtistName,
      };
    }
  }

  if (capsuleArtworkId && wantsSimilar) {
    return {
      mode: 'similar',
      reason: 'User requested artworks similar to the current painting.',
      fromArtworkId: capsuleArtworkId,
      query: capsule?.title ?? coreArtistName ?? undefined,
    };
  }

  // Classification-based requests ("other sculptures", etc.)
  const classificationValue =
    (typeof capsule?.core_facts?.classification === 'string'
      ? (capsule.core_facts.classification as string)
      : undefined) ??
    (typeof capsule?.core_facts?.object_name === 'string'
      ? (capsule.core_facts.object_name as string)
      : undefined);

  if (classificationValue) {
    const classificationLower = classificationValue.toLowerCase();
    if (
      normalized.includes(`other ${classificationLower}`) ||
      normalized.includes(`more ${classificationLower}`)
    ) {
      return {
        mode: 'classification',
        reason: `User requested more works with classification ${classificationValue}.`,
        classification: classificationValue,
      };
    }
  }

  // Look for linked entities in the message
  const entityMatch = matchRelatedEntity(normalized, capsule);
  if (entityMatch) {
    return {
      mode: 'semantic',
      reason: `User asked for works featuring ${entityMatch}.`,
      query: entityMatch,
    };
  }

  const subjectPhrase = extractSubjectPhrase(message);
  if (subjectPhrase) {
    return {
      mode: 'semantic',
      reason: `User described a subject: "${subjectPhrase}".`,
      query: subjectPhrase,
    };
  }

  // Fallback for general "show me more paintings" requests -> artist if available
  if (coreArtistName) {
    return {
      mode: 'constituent',
      reason:
        'Generic request for more works; defaulting to current artist catalogue.',
      fromArtworkId: capsuleArtworkId ?? undefined,
      artistName: coreArtistName,
    };
  }

  return null;
}
