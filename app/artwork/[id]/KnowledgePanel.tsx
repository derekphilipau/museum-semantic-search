import { ExternalLink, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  KnowledgeCapsule,
  CapsuleDocument,
  CapsuleRelatedEntity,
} from '@/lib/knowledge';

interface KnowledgePanelProps {
  capsule: KnowledgeCapsule;
}

function formatRelation(relation?: string) {
  if (!relation) return 'related';
  return relation.replace(/_/g, ' ');
}

function formatRetrievedDate(raw?: string) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function buildEntityDocumentMap(documents: CapsuleDocument[] = []) {
  const map = new Map<string, CapsuleDocument[]>();
  documents.forEach((doc) => {
    (doc.entity_ids || []).forEach((entityId) => {
      if (!map.has(entityId)) {
        map.set(entityId, []);
      }
      map.get(entityId)?.push(doc);
    });
  });
  return map;
}

function getWikidataUrl(entityId: string) {
  if (entityId.startsWith('wd:')) {
    return `https://www.wikidata.org/wiki/${entityId.substring(3)}`;
  }
  return `https://www.wikidata.org/wiki/${entityId}`;
}

function renderRelatedEntities(
  relatedEntities: CapsuleRelatedEntity[] = [],
  documents: CapsuleDocument[] = []
) {
  if (relatedEntities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No additional entities have been linked for this artwork yet.
      </p>
    );
  }

  const docsByEntity = buildEntityDocumentMap(documents);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {relatedEntities.map((entity) => {
        const supportingDocs = docsByEntity.get(entity.entity_id) ?? [];
        return (
          <div
            key={entity.entity_id}
            className="rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">
                {entity.label}
              </span>
              <Badge variant="outline" className="uppercase">
                {formatRelation(entity.relation)}
              </Badge>
            </div>
            {entity.description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {entity.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a
                href={getWikidataUrl(entity.entity_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <Link2 className="h-3 w-3" />
                Wikidata
              </a>
              {supportingDocs.map((doc) =>
                doc.source_url ? (
                  <a
                    key={doc.doc_id}
                    href={doc.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-muted-foreground transition hover:border-primary hover:text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {doc.source_title ?? doc.doc_id}
                  </a>
                ) : null
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderDocuments(documents: CapsuleDocument[] = []) {
  if (documents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Capsule sources have not been indexed for this artwork yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {documents.map((doc) => {
        const snippetCount = doc.snippet_ids?.length ?? 0;
        const retrieved = formatRetrievedDate(doc.source_retrieved);
        return (
          <div
            key={doc.doc_id}
            className="rounded-lg border border-border bg-background/70 p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm text-foreground">
                {doc.source_title ?? doc.doc_id}
              </span>
              {doc.source_type && (
                <Badge variant="secondary" className="uppercase">
                  {doc.source_type}
                </Badge>
              )}
              {doc.capsule_family && (
                <Badge variant="outline" className="uppercase">
                  {doc.capsule_family}
                </Badge>
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <div>
                {snippetCount > 0 && (
                  <span>
                    {snippetCount} snippet{snippetCount === 1 ? '' : 's'}
                  </span>
                )}
                {retrieved && (
                  <span>
                    {snippetCount > 0 ? ' • ' : ''}
                    Snapshotted {retrieved}
                  </span>
                )}
              </div>
              {doc.source_license && (
                <div>License: {doc.source_license}</div>
              )}
              {doc.source_url && (
                <a
                  href={doc.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View snapshot
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function KnowledgePanel({ capsule }: KnowledgePanelProps) {
  const relatedEntities = capsule.related_entities ?? [];
  const documents = capsule.documents ?? [];
  const totalSnippets = capsule.snippet_stats?.total_snippets;
  const buildTimestamp = capsule.build?.generated_at
    ? formatRetrievedDate(capsule.build.generated_at)
    : null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          Trusted Knowledge Capsule
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Offline Wikipedia snapshots and related entities curated specifically
          for this artwork. Responses in the prototype chat pull exclusively
          from these vetted sources.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Related Topics
          </h3>
          <div className="mt-3">
            {renderRelatedEntities(relatedEntities, documents)}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cached Sources
          </h3>
          <div className="mt-3">{renderDocuments(documents)}</div>
        </section>

        <footer className="text-xs text-muted-foreground">
          {typeof totalSnippets === 'number' && (
            <span className="mr-2">
              {totalSnippets.toLocaleString()} total snippets indexed
            </span>
          )}
          {buildTimestamp && (
            <span>Capsule generated {buildTimestamp}</span>
          )}
        </footer>
      </CardContent>
    </Card>
  );
}
