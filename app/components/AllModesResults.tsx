'use client';

import React from 'react';
import { Zap, FileText, ImageIcon } from 'lucide-react';
import { EMBEDDING_MODELS } from '@/lib/embeddings';
import { SearchResponse } from '@/app/types';
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
}

export default function AllModesResults({ 
  query,
  results, 
  loading
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
  // Be defensive: different modes (text vs image) may omit some result buckets
  const semanticBuckets = results?.semantic ? Object.values(results.semantic) : [];
  const hasResults =
    ((results.keyword?.hits?.length ?? 0) > 0) ||
    semanticBuckets.some((r) => (r?.hits?.length ?? 0) > 0) ||
    ((results.hybrid?.results?.hits?.length ?? 0) > 0);

  if (!hasResults) {
    return (
      <Card className="p-8">
        <div className="text-center text-muted-foreground">
          <p>No results found for &quot;{query}&quot;</p>
          <p className="text-sm mt-2">Try different search terms</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Fixed 4-column grid layout: keyword, Jina text, Jina CLIP, hybrid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Keyword Search (ES text only) */}
        <SearchResultColumn
          title="Keyword"
          description="Elasticsearch Text matching"
          icon={FileText}
          hits={results.keyword?.hits || []}
          gradientFrom="from-blue-500"
          gradientTo="to-blue-600"
          badgeColor="bg-blue-700"
          responseTime={results.keyword?.took}
          totalResults={results.keyword?.total}
        />

        {/* 2. Jina text embeddings */}
        <SearchResultColumn
          title={EMBEDDING_MODELS.jina_text?.name || 'Jina Text'}
          description={
            EMBEDDING_MODELS.jina_text?.description || 'Jina-powered semantic text search'
          }
          icon={FileText}
          hits={results.semantic.jina_text?.hits || []}
          gradientFrom="from-orange-500"
          gradientTo="to-orange-600"
          badgeColor="bg-orange-700"
          modelUrl={EMBEDDING_MODELS.jina_text?.url}
          showExternalLink={true}
          responseTime={results.semantic.jina_text?.took}
          totalResults={results.semantic.jina_text?.total}
        />

        {/* 3. Jina CLIP (cross-modal) */}
        <SearchResultColumn
          title={
            EMBEDDING_MODELS.jina_clip?.name || 'Jina CLIP v2'
          }
          description={
            EMBEDDING_MODELS.jina_clip?.description || 'Cross-modal text ↔ image search (Jina CLIP v2)'
          }
          icon={ImageIcon}
          hits={results.semantic.jina_clip?.hits || []}
          gradientFrom="from-purple-500"
          gradientTo="to-purple-600"
          badgeColor="bg-purple-700"
          modelUrl={EMBEDDING_MODELS.jina_clip?.url}
          showExternalLink={true}
          responseTime={results.semantic.jina_clip?.took}
          totalResults={results.semantic.jina_clip?.total}
        />

        {/* 4. Hybrid Search (Jina text + Jina CLIP) */}
        <SearchResultColumn
          title="Hybrid"
          description="Jina text + Jina CLIP"
          icon={Zap}
          hits={results.hybrid?.results?.hits || []}
          gradientFrom="from-amber-500"
          gradientTo="to-amber-600"
          badgeColor="bg-amber-700"
          responseTime={results.hybrid?.results?.took}
          totalResults={results.hybrid?.results?.total}
        />
      </div>


    </div>
  );
}
