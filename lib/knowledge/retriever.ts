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
}

type HybridQuery = Record<string, unknown>;

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

function buildHybridQuery({
  artifactId,
  query,
  size = 12,
  vector,
}: RetrieveSnippetsOptions): HybridQuery {
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

  const knn: Record<string, unknown> | undefined = vector
    ? {
        field: 'embedding',
        query_vector: vector,
        k: Math.max(size, 50),
        num_candidates: Math.max(size * 4, 200),
        filter: {
          term: { artifact_id: artifactId },
        },
      }
    : undefined;

  const queries: Array<Record<string, unknown>> = [
    {
      bool: {
        must,
        should,
        minimum_should_match: 1,
      },
    },
  ];

  if (knn) {
    queries.push({ knn });
  }

  return {
    hybrid: {
      queries,
    },
    size,
  };
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
    body: buildHybridQuery({ ...options, vector }),
  });

  const hits = (response.hits?.hits ?? []) as RawSnippetHit[];
  return hits
    .map(mapHitToSnippet)
    .filter((snippet): snippet is KnowledgeSnippet => snippet !== null);
}
