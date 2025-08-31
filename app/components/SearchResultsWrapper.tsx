'use client';

import { SearchResponse, Artwork, SearchMetadata } from '@/app/types';
import AllModesResults from './AllModesResults';

interface SearchResultsWrapperProps {
  query: string;
  results: {
    keyword: SearchResponse | null;
    semantic: Record<string, SearchResponse>;
    hybrid: { model: string; results: SearchResponse } | null;
    metadata?: SearchMetadata;
  };
}

export default function SearchResultsWrapper({ query, results }: SearchResultsWrapperProps) {
  const handleSelectArtwork = (artwork: Artwork) => {
    // Navigation is handled by Link components in ArtworkCard
  };

  return (
    <div className="space-y-4">
      {results.metadata && (
        <div className="text-xs text-gray-500 flex gap-4">
          {results.metadata.indexName && (
            <span>Index: {results.metadata.indexName}</span>
          )}
          <span>Size: {results.metadata.indexSizeHuman}</span>
          <span>Documents: {results.metadata.totalDocuments.toLocaleString()}</span>
          {results.metadata.totalQueryTime && (
            <span>Total time: {results.metadata.totalQueryTime}ms</span>
          )}
        </div>
      )}
      <AllModesResults
        query={query}
        results={results}
        loading={false}
        onSelectArtwork={handleSelectArtwork}
      />
    </div>
  );
}