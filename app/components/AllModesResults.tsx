'use client';

import React from 'react';
import { Search, Brain, Zap } from 'lucide-react';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { Artwork, SearchResponse } from '@/app/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import SearchResultColumn from './SearchResultColumn';

interface AllModesResultsProps {
  query: string;
  results: {
    keyword: SearchResponse | null;
    semantic: Record<string, SearchResponse>;
    hybrid: { model: string; results: SearchResponse } | null;
  };
  loading: boolean;
  onSelectArtwork: (artwork: Artwork) => void;
}

// Model metadata with URLs and descriptions
const MODEL_INFO = {
  jina_clip_v2: {
    url: 'https://huggingface.co/jinaai/jina-clip-v2',
    description: '🎨 Best for Art (2024)',
    year: '2024'
  },
  jina_embeddings_v4: {
    url: 'https://jina.ai/embeddings/',
    description: '🚀 Text+Image Fusion (2025)',
    year: '2025'
  },
  google_vertex_multimodal: {
    url: 'https://cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-multimodal-embeddings',
    description: '🆓 Free Tier (2024)',
    year: '2024'
  }
} as const;

export default function AllModesResults({ 
  query,
  results, 
  loading,
  onSelectArtwork 
}: AllModesResultsProps) {
  
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Loading skeletons for 5 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="py-0">
              <CardHeader>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32 mt-1" />
              </CardHeader>
              <CardContent className="space-y-3">
                {[...Array(3)].map((_, j) => (
                  <Skeleton key={j} className="h-24 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!query) {
    return (
      <Card className="p-8">
        <div className="text-center text-muted-foreground">
          Enter a search query to explore artworks
        </div>
      </Card>
    );
  }

  // Check if we have any results
  const hasResults = 
    (results.keyword && results.keyword.hits.length > 0) ||
    Object.values(results.semantic).some(r => r && r.hits.length > 0) ||
    (results.hybrid?.results && results.hybrid.results.hits.length > 0);

  if (!hasResults) {
    return (
      <Card className="p-8">
        <div className="text-center text-muted-foreground">
          <p>No results found for "{query}"</p>
          <p className="text-sm mt-2">Try different search terms</p>
        </div>
      </Card>
    );
  }

  // Get ordered models
  const orderedModels = Object.keys(EMBEDDING_MODELS).sort((a, b) => {
    const yearA = parseInt(EMBEDDING_MODELS[a as keyof typeof EMBEDDING_MODELS].year);
    const yearB = parseInt(EMBEDDING_MODELS[b as keyof typeof EMBEDDING_MODELS].year);
    return yearB - yearA; // Most recent first
  });

  return (
    <div className="space-y-8">
      {/* Fixed 5-column grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Keyword Search - Single Column */}
        {results.keyword !== null && (
          <SearchResultColumn
              title="Keyword"
              description="Native Elasticsearch"
              icon={Search}
              hits={results.keyword.hits}
              gradientFrom="from-blue-500"
              gradientTo="to-blue-600"
              badgeColor="secondary"
              onSelectArtwork={onSelectArtwork}
            />
          )}

          {/* Visual Similarity - One column per model */}
          {orderedModels.map((modelKey) => {
            const model = EMBEDDING_MODELS[modelKey as keyof typeof EMBEDDING_MODELS];
            const semanticResults = results.semantic[modelKey];
            
            // Skip if no results for this model
            if (!semanticResults) return null;
            
            return (
              <SearchResultColumn
                key={`semantic-${modelKey}`}
                title={model.name}
                description={MODEL_INFO[modelKey as keyof typeof MODEL_INFO]?.description || model.notes}
                icon={Brain}
                hits={semanticResults.hits}
                gradientFrom="from-purple-500"
                gradientTo="to-purple-600"
                badgeColor="bg-purple-700"
                onSelectArtwork={onSelectArtwork}
                modelUrl={MODEL_INFO[modelKey as keyof typeof MODEL_INFO]?.url}
                showExternalLink={true}
            />
          );
        })}

        {/* Hybrid Search - Single Column */}
        {results.hybrid !== null && (
          <SearchResultColumn
            title="Hybrid"
            description={results.hybrid ? EMBEDDING_MODELS[results.hybrid.model as keyof typeof EMBEDDING_MODELS]?.name : 'Not selected'}
            icon={Zap}
            hits={results.hybrid?.results?.hits || []}
            gradientFrom="from-green-500"
            gradientTo="to-green-600"
            badgeColor="bg-green-700"
            onSelectArtwork={onSelectArtwork}
          />
        )}
      </div>

    </div>
  );
}