import { getElasticsearchClient } from '@/lib/elasticsearch/client';
import { embedJinaText } from '@/lib/embeddings';
import { KnowledgeSnippet } from './types';

const KNOWLEDGE_INDEX =
  process.env.ELASTICSEARCH_KNOWLEDGE_INDEX || 'knowledge_snippets';

interface RetrieveSnippetsOptions {
  artifactId: string;
  query: string;
  size?: number;
  vector?: number[];
  filters?: Array<Record<string, unknown>>;
}

interface RawSnippetSource {
  snippet_id?: string;
  artifact_id: string;
  doc_id?: string;
  capsule_family?: string;
  source_title?: string;
  source_type?: string;
  source_url?: string;
  section_heading?: string | null;
  text?: string;
  entity_ids?: string[];
  source_retrieved?: string;
  source_license?: string;
  doc_path?: string;
}

interface RawSnippetHit {
  _id: string;
  _score?: number;
  _source?: RawSnippetSource;
}

function buildSearchBody({
  artifactId,
  query,
  size = 12,
  vector,
  filters = [],
}: RetrieveSnippetsOptions): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [
    {
      term: {
        artifact_id: artifactId,
      },
    },
  ];

  const should: Array<Record<string, unknown>> = [
    {
      match: {
        text: {
          query,
          boost: 2,
        },
      },
    },
    {
      multi_match: {
        query,
        fields: ['source_title^1.5', 'section_heading', 'doc_id'],
        type: 'most_fields',
        boost: 0.7,
      },
    },
  ];

  const boolQuery: Record<string, unknown> = {
    must,
    should,
    minimum_should_match: 1,
  };

  if (filters.length > 0) {
    (boolQuery as Record<string, unknown>).filter = filters;
  }

  const body: Record<string, unknown> = {
    size,
    query: {
      bool: boolQuery,
    },
  };

  if (vector) {
    const knnFilters = [
      {
        term: { artifact_id: artifactId },
      },
      ...filters,
    ];

    body.knn = {
      field: 'embedding',
      query_vector: vector,
      k: Math.max(size, 50),
      num_candidates: Math.max(size * 4, 200),
      filter:
        knnFilters.length === 1
          ? knnFilters[0]
          : {
              bool: {
                must: knnFilters,
              },
            },
    };
  }

  return body;
}

function mapHitToSnippet(hit: RawSnippetHit): KnowledgeSnippet | null {
  const source = hit._source;
  if (!source || !source.text) {
    return null;
  }

  return {
    snippetId: source.snippet_id ?? hit._id,
    artifactId: source.artifact_id,
    docId: source.doc_id ?? '',
    capsuleFamily: source.capsule_family ?? 'artwork',
    sourceTitle: source.source_title ?? '',
    sourceType: source.source_type,
    sourceUrl: source.source_url,
    sectionHeading: source.section_heading,
    text: source.text,
    entityIds: source.entity_ids,
    score: hit._score ?? 0,
    metadata: {
      source_retrieved: source.source_retrieved,
      source_license: source.source_license,
      doc_path: source.doc_path,
    },
  };
}

export async function retrieveKnowledgeSnippets(
  options: RetrieveSnippetsOptions
): Promise<KnowledgeSnippet[]> {
  const client = getElasticsearchClient();
  const vector =
    options.vector ?? (await embedJinaText(options.query)).values;

  const response = await client.search<RawSnippetSource>({
    index: KNOWLEDGE_INDEX,
    body: buildSearchBody({ ...options, vector }),
  });

  const hits = (response.hits?.hits ?? []) as RawSnippetHit[];
  const snippets = hits
    .map(mapHitToSnippet)
    .filter((snippet): snippet is KnowledgeSnippet => snippet !== null);

  const merged = new Map<string, KnowledgeSnippet>();
  const addSnippets = (list: KnowledgeSnippet[]) => {
    list.forEach((snippet) => {
      const existing = merged.get(snippet.snippetId);
      if (!existing || (existing.score ?? 0) < (snippet.score ?? 0)) {
        merged.set(snippet.snippetId, snippet);
      }
    });
  };

  addSnippets(snippets);

  const MIN_MANUAL = Number.parseInt(
    process.env.KNOWLEDGE_MIN_MANUAL_SNIPPETS || '2',
    10
  );
  const manualCount = snippets.filter(
    (snippet) => snippet.sourceType === 'manual'
  ).length;

  if (manualCount < MIN_MANUAL) {
    const manualResponse = await client.search<RawSnippetSource>({
      index: KNOWLEDGE_INDEX,
      body: buildSearchBody({
        ...options,
        vector,
        size: MIN_MANUAL,
        filters: [{ term: { source_type: 'manual' } }],
      }),
    });
    const manualHits = (manualResponse.hits?.hits ?? []) as RawSnippetHit[];
    const manualSnippets = manualHits
      .map(mapHitToSnippet)
      .filter((snippet): snippet is KnowledgeSnippet => snippet !== null);

    addSnippets(manualSnippets);
  }

  const manualTarget = Math.max(MIN_MANUAL, 3);
  const sizeLimit = options.size ?? 12;

  const manualSnippets = Array.from(merged.values()).filter(
    (snippet) => snippet.sourceType === 'manual'
  );
  const otherSnippets = Array.from(merged.values()).filter(
    (snippet) => snippet.sourceType !== 'manual'
  );

  const scoreSnippet = (snippet: KnowledgeSnippet) => {
    const base = snippet.score ?? 0;
    let boost = 0;
    if (snippet.sourceType === 'manual') {
      boost += 1.5;
    }
    if (snippet.capsuleFamily === 'artwork') {
      boost += 0.3;
    }
    return base + boost;
  };

  manualSnippets.sort((a, b) => scoreSnippet(b) - scoreSnippet(a));
  otherSnippets.sort((a, b) => scoreSnippet(b) - scoreSnippet(a));

  const prioritizedManual = manualSnippets.slice(0, manualTarget);
  const combined = [...prioritizedManual];

  for (const snippet of otherSnippets) {
    if (combined.length >= sizeLimit) break;
    if (!combined.find((item) => item.snippetId === snippet.snippetId)) {
      combined.push(snippet);
    }
  }

  if (combined.length < sizeLimit) {
    for (const snippet of manualSnippets.slice(prioritizedManual.length)) {
      if (combined.length >= sizeLimit) break;
      if (!combined.find((item) => item.snippetId === snippet.snippetId)) {
        combined.push(snippet);
      }
    }
  }

  const finalSnippets = combined.slice(0, sizeLimit);

  if (process.env.DEBUG_KNOWLEDGE_RETRIEVAL === '1') {
    const topSnippets = finalSnippets.slice(0, 3).map((snippet) => ({
      snippetId: snippet.snippetId,
      sourceTitle: snippet.sourceTitle,
      score: snippet.score,
    }));
    console.debug('[knowledge] search', {
      artifactId: options.artifactId,
      query: options.query,
      size: options.size,
      hits: finalSnippets.length,
      topSnippets,
    });
  }

  return finalSnippets;
}
