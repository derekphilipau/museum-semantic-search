import { embedJinaText } from '@/lib/embeddings';
import {
  ARTWORK_SUMMARY_FIELDS,
  INDEX_NAME,
  getElasticsearchClient,
  performSemanticSearchWithEmbedding,
  findSimilarArtworks,
} from '@/lib/elasticsearch/client';
import type {
  SearchHit,
  SearchResponseWithQuery,
  ESSearchQuery,
} from '@/app/types';

export interface ArtworkSearchResult {
  id: string;
  title: string;
  artist?: string;
  classification?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  score?: number;
  docId?: string;
}

export interface ArtworkSearchPayload {
  results: ArtworkSearchResult[];
  total: number;
  query?: SearchResponseWithQuery['esQuery'];
}

interface ConstituentSearchOptions {
  artistId?: string;
  artistName?: string;
  excludeIds?: string[];
  size?: number;
}

interface ClassificationSearchOptions {
  classification: string;
  excludeIds?: string[];
  size?: number;
}

interface SemanticSearchOptions {
  text: string;
  excludeIds?: string[];
  size?: number;
}
interface SimilarSearchOptions {
  artworkId: string;
  excludeIds?: string[];
  size?: number;
}

const DEFAULT_SIZE = 8;

function normalizeImageSource(image: unknown): {
  imageUrl?: string;
  thumbnailUrl?: string;
} {
  if (!image) {
    return {};
  }

  if (typeof image === 'string') {
    return { imageUrl: image, thumbnailUrl: image };
  }

  if (typeof image === 'object') {
    const img = image as Record<string, unknown>;
    const imageUrl =
      (typeof img.url === 'string' && img.url) ||
      (typeof img.iiifUrl === 'string' && img.iiifUrl) ||
      undefined;
    const thumbnailUrl =
      (typeof img.thumbnailUrl === 'string' && img.thumbnailUrl) ||
      imageUrl;
    return { imageUrl, thumbnailUrl };
  }

  return {};
}

function mapHitToResult(hit: SearchHit): ArtworkSearchResult {
  const source = hit._source;
  const { imageUrl, thumbnailUrl } = normalizeImageSource(source.image);

  return {
    id: source.id,
    docId: hit._id,
    title: source.title,
    artist: source.artist,
    classification: source.classification,
    imageUrl,
    thumbnailUrl,
    score: hit._score,
  };
}

function dedupeResults(results: ArtworkSearchResult[]): ArtworkSearchResult[] {
  const seen = new Set<string>();
  const deduped: ArtworkSearchResult[] = [];

  results.forEach((result) => {
    const key = result.docId ?? result.id;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  });

  return deduped;
}

function applyExclusions(
  hits: SearchHit[],
  excludeIds: string[] = []
): SearchHit[] {
  if (!excludeIds.length) {
    return hits;
  }
  const excludeSet = new Set(excludeIds);
  return hits.filter(
    (hit) =>
      !excludeSet.has(hit._source.id) && !excludeSet.has(hit._id ?? '')
  );
}

async function runFacetSearch(
  body: Record<string, unknown>
): Promise<SearchResponseWithQuery> {
  const client = getElasticsearchClient();
  const response = await client.search({
    index: INDEX_NAME,
    ...body,
    _source: ARTWORK_SUMMARY_FIELDS,
  });

  const mappedHits = (response.hits.hits as SearchHit[]).map((hit) => ({
    _id: hit._id,
    _score: hit._score ?? 0,
    _source: hit._source,
  }));

  const esQuery: ESSearchQuery = {
    size: (body.size as number) ?? mappedHits.length,
    query: body.query as ESSearchQuery['query'],
  };

  return {
    took: response.took,
    total:
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value ?? 0,
    hits: mappedHits,
    esQuery,
  };
}

export async function searchArtworksByConstituent({
  artistId,
  artistName,
  excludeIds = [],
  size = DEFAULT_SIZE,
}: ConstituentSearchOptions): Promise<ArtworkSearchPayload> {
  if (!artistId && !artistName) {
    return { results: [], total: 0 };
  }

  const filters: Array<Record<string, unknown>> = [];

  if (artistId) {
    filters.push({
      nested: {
        path: 'artists',
        query: {
          term: {
            'artists.constituentId': artistId,
          },
        },
      },
    });
  } else if (artistName) {
    filters.push({
      bool: {
        should: [
          {
            term: {
              'artist.keyword': artistName,
            },
          },
          {
            nested: {
              path: 'artists',
              query: {
                match_phrase: {
                  'artists.displayName': artistName,
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }

  const mustNot = excludeIds.length
    ? [
        {
          ids: {
            values: excludeIds,
          },
        },
      ]
    : undefined;

  const searchBody = {
    size: Math.min(size * 2, 40),
    query: {
      bool: {
        filter: filters,
        must_not: mustNot,
      },
    },
  };

  const response = await runFacetSearch(searchBody);
  const filteredHits = applyExclusions(response.hits, excludeIds).slice(
    0,
    size
  );
  const results = dedupeResults(filteredHits.map(mapHitToResult));

  return {
    results,
    total: response.total,
    query: response.esQuery as ESSearchQuery | undefined,
  };
}

export async function searchArtworksByClassification({
  classification,
  excludeIds = [],
  size = DEFAULT_SIZE,
}: ClassificationSearchOptions): Promise<ArtworkSearchPayload> {
  if (!classification) {
    return { results: [], total: 0 };
  }

  const mustNot = excludeIds.length
    ? [
        {
          ids: {
            values: excludeIds,
          },
        },
      ]
    : undefined;

  const searchBody = {
    size: Math.min(size * 2, 40),
    query: {
      bool: {
        filter: [
          {
            term: {
              classification,
            },
          },
        ],
        must_not: mustNot,
      },
    },
  };

  const response = await runFacetSearch(searchBody);
  const filteredHits = applyExclusions(response.hits, excludeIds).slice(
    0,
    size
  );
  const results = dedupeResults(filteredHits.map(mapHitToResult));

  return {
    results,
    total: response.total,
    query: response.esQuery,
  };
}

export async function searchArtworksBySemanticText({
  text,
  excludeIds = [],
  size = DEFAULT_SIZE,
}: SemanticSearchOptions): Promise<ArtworkSearchPayload> {
  if (!text.trim()) {
    return { results: [], total: 0 };
  }

  const vector = await embedJinaText(text);
  const response = await performSemanticSearchWithEmbedding(
    vector.values,
    'jina_text',
    Math.min(size * 2, 40)
  );

  const filteredHits = applyExclusions(response.hits, excludeIds).slice(
    0,
    size
  );
  const results = dedupeResults(filteredHits.map(mapHitToResult));

  return {
    results,
    total: response.total,
    query: response.esQuery,
  };
}

export async function searchArtworksSimilar({
  artworkId,
  excludeIds = [],
  size = DEFAULT_SIZE,
}: SimilarSearchOptions): Promise<ArtworkSearchPayload> {
  if (!artworkId) {
    return { results: [], total: 0 };
  }

  const response = await findSimilarArtworks(artworkId, 'jina_text', size * 2);
  const filteredHits = applyExclusions(response.hits, [
    artworkId,
    ...excludeIds,
  ]).slice(0, size);
  const results = dedupeResults(filteredHits.map(mapHitToResult));

  return {
    results,
    total: response.total,
    query: undefined,
  };
}
