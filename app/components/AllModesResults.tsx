'use client';

import React from 'react';
import { Search, Brain, Zap, FileText, Image, Layers } from 'lucide-react';
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
  jina_embeddings_v3: {
    url: 'https://jina.ai/embeddings/',
    description: 'Text-only semantic search',
    year: '2024'
  },
  jina_embeddings_v4: {
    url: 'https://jina.ai/embeddings/',
    description: 'Text + Image fusion',
    year: '2025'
  },
  google_vertex_multimodal: {
    url: 'https://cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-multimodal-embeddings',
    description: 'Text + Image fusion',
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
        {/* Loading skeletons for 4 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
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

  return (
    <div className="space-y-8">
      {/* Fixed 5-column grid layout: ES text, Jina v3 text, Jina v4, Google, Hybrid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 1. Keyword Search (ES text only) */}
        <SearchResultColumn
          title="Keyword"
          description="Text matching"
          icon={FileText}
          hits={results.keyword?.hits || []}
          gradientFrom="from-blue-500"
          gradientTo="to-blue-600"
          badgeColor="bg-blue-700"
          onSelectArtwork={onSelectArtwork}
          responseTime={results.keyword?.took}
          totalResults={results.keyword?.total}
        />

        {/* 2. Jina v3 (Text only embeddings) */}
        <SearchResultColumn
          title={EMBEDDING_MODELS.jina_embeddings_v3?.name || 'Jina v3'}
          description={MODEL_INFO.jina_embeddings_v3?.description || 'Text-only embeddings'}
          icon={FileText}
          hits={results.semantic.jina_embeddings_v3?.hits || []}
          gradientFrom="from-indigo-500"
          gradientTo="to-indigo-600"
          badgeColor="bg-indigo-700"
          onSelectArtwork={onSelectArtwork}
          modelUrl={MODEL_INFO.jina_embeddings_v3?.url}
          showExternalLink={true}
          responseTime={results.semantic.jina_embeddings_v3?.took}
          totalResults={results.semantic.jina_embeddings_v3?.total}
        />

        {/* 3. Jina v4 (Multimodal - text + image) */}
        <SearchResultColumn
          title={EMBEDDING_MODELS.jina_embeddings_v4?.name || 'Jina v4'}
          description={MODEL_INFO.jina_embeddings_v4?.description || 'Multimodal embeddings'}
          icon={Layers}
          hits={results.semantic.jina_embeddings_v4?.hits || []}
          gradientFrom="from-teal-500"
          gradientTo="to-teal-600"
          badgeColor="bg-teal-700"
          onSelectArtwork={onSelectArtwork}
          modelUrl={MODEL_INFO.jina_embeddings_v4?.url}
          showExternalLink={true}
          responseTime={results.semantic.jina_embeddings_v4?.took}
          totalResults={results.semantic.jina_embeddings_v4?.total}
        />

        {/* 4. Google Vertex (Multimodal - text + image) */}
        <SearchResultColumn
          title={EMBEDDING_MODELS.google_vertex_multimodal?.name || 'Google Vertex'}
          description={MODEL_INFO.google_vertex_multimodal?.description || 'Multimodal embeddings'}
          icon={Layers}
          hits={results.semantic.google_vertex_multimodal?.hits || []}
          gradientFrom="from-emerald-500"
          gradientTo="to-emerald-600"
          badgeColor="bg-emerald-700"
          onSelectArtwork={onSelectArtwork}
          modelUrl={MODEL_INFO.google_vertex_multimodal?.url}
          showExternalLink={true}
          responseTime={results.semantic.google_vertex_multimodal?.took}
          totalResults={results.semantic.google_vertex_multimodal?.total}
        />

        {/* 5. Hybrid Search (combines keyword + semantic) */}
        <SearchResultColumn
          title="Hybrid"
          description="Keyword + Semantic"
          icon={Zap}
          hits={results.hybrid?.results?.hits || []}
          gradientFrom="from-amber-500"
          gradientTo="to-amber-600"
          badgeColor="bg-amber-700"
          onSelectArtwork={onSelectArtwork}
          responseTime={results.hybrid?.results?.took}
          totalResults={results.hybrid?.results?.total}
        />
      </div>

    </div>
  );
}