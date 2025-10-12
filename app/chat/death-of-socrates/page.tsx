import { Metadata } from 'next';
import KnowledgePanel from '@/app/artwork/[id]/KnowledgePanel';
import { loadKnowledgeCapsule } from '@/lib/knowledge';
import ChatExperience from './ChatExperience';
import {
  getElasticsearchClient,
  INDEX_NAME,
} from '@/lib/elasticsearch/client';
import { Artwork } from '@/app/types';

const ARTIFACT_ID = 'met_436105';
const PAGE_TITLE = 'The Death of Socrates — Capsule Chat Prototype';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description:
    'Prototype chat experience grounded in the trusted knowledge capsule for Jacques-Louis David’s The Death of Socrates.',
};

async function loadArtwork(): Promise<Artwork | null> {
  try {
    const client = getElasticsearchClient();
    const result = await client.get({
      index: INDEX_NAME,
      id: ARTIFACT_ID,
      _source_excludes: ['embeddings'],
    });

    if (!result.found) {
      return null;
    }

    return result._source as Artwork;
  } catch (error) {
    console.error('Failed to load artwork for chat page:', error);
    return null;
  }
}

export default async function SocratesChatPage() {
  const [capsule, artwork] = await Promise.all([
    loadKnowledgeCapsule(ARTIFACT_ID),
    loadArtwork(),
  ]);
  const heroImage =
    typeof artwork?.image === 'string'
      ? artwork.image
      : artwork?.image?.url ?? null;
  const heroAlt =
    artwork?.visual_description?.alt_text ??
    (artwork?.title
      ? `${artwork.title} by ${artwork.artist || 'Unknown artist'}`
      : 'Artwork image');

  return (
    <div className="container mx-auto flex flex-col gap-8 px-4 py-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold text-foreground">{PAGE_TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          This dedicated workspace lets you explore the painting using only
          vetted capsule content. Ask about the artwork, its subjects, or the
          surrounding philosophy and the assistant will respond with inline
          citations pointing to cached Wikipedia snippets.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-[360px] lg:flex-shrink-0">
          {heroImage && (
            <figure className="overflow-hidden rounded-2xl border border-border/80 bg-background shadow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImage}
                alt={heroAlt}
                className="h-auto w-full object-cover"
              />
              <figcaption className="space-y-1 px-4 py-3 text-sm">
                <div className="font-semibold text-foreground">
                  {artwork?.title ?? 'The Death of Socrates'}
                </div>
                <div className="text-muted-foreground">
                  {artwork?.artist ?? 'Jacques-Louis David'} ·{' '}
                  {artwork?.date ?? '1787'} ·{' '}
                  {artwork?.medium ?? 'Oil on canvas'}
                </div>
                {artwork?.creditLine && (
                  <div className="text-xs text-muted-foreground">
                    {artwork.creditLine}
                  </div>
                )}
              </figcaption>
            </figure>
          )}
        </div>

        <section className="flex-1">
          <ChatExperience artifactId={ARTIFACT_ID} capsule={capsule} />
        </section>
      </div>

      <section>
        {capsule ? (
          <KnowledgePanel capsule={capsule} />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            Capsule metadata could not be loaded. The chat experience will still
            operate, but source details and entity context will be limited.
          </div>
        )}
      </section>
    </div>
  );
}
