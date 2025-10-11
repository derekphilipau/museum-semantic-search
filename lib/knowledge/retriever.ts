import { createElasticsearchClient } from '@/lib/elasticsearch/client';
import { generateUnifiedEmbeddings, extractJinaV3Embedding } from '@/lib/embeddings/unified';
import { KnowledgeSnippet } from './types';

const KNOWLEDGE_INDEX = process.env.ELASTICSEARCH_KNOWLEDGE_INDEX || 'knowledge_snippets';

interface RetrieveSnippetsOptions {
  artifactId: string;
  query: string;
  size?: number;
  vector?: number[];
}

function buildHybridQuery({ artifactId, query, size = 12, vector }: RetrieveSnippetsOptions) {
  const must: any[] = [
    {
      term: {
        artifact_id: artifactId,
      },
    },
  ];

  const should: any[] = [
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

  const knn: any = vector
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

  return {
    hybrid: {
      queries: [
        {
          bool: {
            must,
            should,
            minimum_should_match: 1,
          },
        },
        ...(knn
          ? [
              {
                knn,
              },
            ]
          : []),
      ],
    },
    size,
  };
}

export async function retrieveKnowledgeSnippets(options: RetrieveSnippetsOptions): Promise<KnowledgeSnippet[]> {
  const client = createElasticsearchClient();
  const vector = options.vector ?? extractJinaV3Embedding(await generateUnifiedEmbeddings(options.query)).embedding;

  const response = await client.search({
    index: KNOWLEDGE_INDEX,
    body: buildHybridQuery({ ...options, vector }),
  });

  const hits = response.hits?.hits ?? [];
  return hits.map((hit: any) => ({
    snippetId: hit._source.snippet_id ?? hit._id,
    artifactId: hit._source.artifact_id,
    docId: hit._source.doc_id,
    capsuleFamily: hit._source.capsule_family,
    sourceTitle: hit._source.source_title,
    sourceType: hit._source.source_type,
    sourceUrl: hit._source.source_url,
    sectionHeading: hit._source.section_heading,
    text: hit._source.text,
    entityIds: hit._source.entity_ids,
    score: hit._score ?? 0,
    metadata: {
      source_retrieved: hit._source.source_retrieved,
      source_license: hit._source.source_license,
      doc_path: hit._source.doc_path,
    },
  }));
}
