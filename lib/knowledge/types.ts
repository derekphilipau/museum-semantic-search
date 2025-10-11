export interface KnowledgeSnippet {
  snippetId: string;
  artifactId: string;
  docId: string;
  capsuleFamily: string;
  sourceTitle: string;
  sourceType?: string;
  sourceUrl?: string;
  sectionHeading?: string | null;
  text: string;
  entityIds?: string[];
  score: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeRetrievalResult {
  snippets: KnowledgeSnippet[];
}
