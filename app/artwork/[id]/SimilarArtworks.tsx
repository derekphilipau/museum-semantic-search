'use client';

import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';
import SearchResultColumn from '@/app/components/SearchResultColumn';
import { Brain, Sparkles, FileText, Image, Database } from 'lucide-react';

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

  // Check if we have combined and metadata results
  const hasCombinedResults = similarArtworks.combined?.hits?.length > 0;
  const hasMetadataResults = similarArtworks.metadata?.hits?.length > 0;
  
  // Determine grid columns based on available results
  let gridCols = 'md:grid-cols-2';
  if (hasCombinedResults && hasMetadataResults) {
    gridCols = 'md:grid-cols-4';
  } else if (hasCombinedResults || hasMetadataResults) {
    gridCols = 'md:grid-cols-3';
  }

  return (
    <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
      {/* 1. Metadata-based results column */}
      {hasMetadataResults && (
        <SearchResultColumn
          key="metadata"
          title="Metadata Similarity"
          description="Based on artist, period, medium, and style"
          icon={Database}
          hits={similarArtworks.metadata.hits || []}
          gradientFrom="from-orange-500"
          gradientTo="to-orange-600"
          badgeColor="bg-orange-700"
          onSelectArtwork={() => {}}
          responseTime={similarArtworks.metadata.took}
          totalResults={similarArtworks.metadata.total}
        />
      )}
      
      {/* 2. Jina v3 Text results */}
      {similarArtworks.jina_v3 && (
        <SearchResultColumn
          key="jina_v3"
          title={EMBEDDING_MODELS.jina_v3.name}
          description={EMBEDDING_MODELS.jina_v3.notes}
          icon={FileText}
          hits={similarArtworks.jina_v3.hits || []}
          gradientFrom="from-blue-500"
          gradientTo="to-blue-600"
          badgeColor="bg-blue-700"
          onSelectArtwork={() => {}}
          responseTime={similarArtworks.jina_v3.took}
          totalResults={similarArtworks.jina_v3.total}
        />
      )}
      
      {/* 3. SigLIP 2 results */}
      {similarArtworks.siglip2 && (
        <SearchResultColumn
          key="siglip2"
          title={EMBEDDING_MODELS.siglip2.name}
          description={EMBEDDING_MODELS.siglip2.notes}
          icon={Image}
          hits={similarArtworks.siglip2.hits || []}
          gradientFrom="from-purple-500"
          gradientTo="to-purple-600"
          badgeColor="bg-purple-700"
          onSelectArtwork={() => {}}
          responseTime={similarArtworks.siglip2.took}
          totalResults={similarArtworks.siglip2.total}
        />
      )}
      
      {/* 4. Combined results column */}
      {hasCombinedResults && (
        <SearchResultColumn
          key="combined"
          title="Combined Similarity"
          description="Fusion of text, visual, and metadata similarity"
          icon={Sparkles}
          hits={similarArtworks.combined.hits || []}
          gradientFrom="from-green-500"
          gradientTo="to-green-600"
          badgeColor="bg-green-700"
          onSelectArtwork={() => {}}
          responseTime={similarArtworks.combined.took}
          totalResults={similarArtworks.combined.total}
        />
      )}
    </div>
  );
}