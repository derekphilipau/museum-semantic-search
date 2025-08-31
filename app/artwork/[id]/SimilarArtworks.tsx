'use client';

import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';
import SearchResultColumn from '@/app/components/SearchResultColumn';
import { Brain } from 'lucide-react';

interface SimilarArtworksProps {
  similarArtworks: Record<string, SearchResponse>;
}

export default function SimilarArtworks({ similarArtworks }: SimilarArtworksProps) {
  const hasAnyResults = Object.values(similarArtworks).some(
    results => results?.hits?.length > 0
  );

  if (!hasAnyResults) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No similar artworks found.</p>
        <p className="text-sm mt-2">This artwork may not have embeddings generated yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(EMBEDDING_MODELS).map(([modelKey, model]) => {
        const results = similarArtworks[modelKey];
        if (!results || !results.hits || results.hits.length === 0) {
          return null;
        }
        
        return (
          <SearchResultColumn
            key={modelKey}
            title={model.name}
            description={model.notes}
            icon={Brain}
            hits={results.hits}
            gradientFrom="from-purple-500"
            gradientTo="to-purple-600"
            badgeColor="bg-purple-700"
            onSelectArtwork={() => {}}
          />
        );
      })}
    </div>
  );
}