'use client';

import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { SearchResponse, SearchHit } from '@/app/types';
import SearchResultColumn from '@/app/components/SearchResultColumn';
import { Sparkles, FileText, Image, Database, Brain } from 'lucide-react';

interface SimilarArtworksProps {
  similarArtworks: Record<string, SearchResponse>;
  precomputedHits: SearchHit[];
}

export default function SimilarArtworks({ similarArtworks, precomputedHits }: SimilarArtworksProps) {
  const hasAnyResults = Object.values(similarArtworks).some(
    results => results?.hits?.length > 0
  );
  const hasPrecomputed = precomputedHits.length > 0;

  if (!hasAnyResults && !hasPrecomputed) {
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
  
  // Count the number of columns we'll display
  let columnCount = 0;
  if (hasPrecomputed) columnCount++;
  if (hasMetadataResults) columnCount++;
  if (similarArtworks.jina_v3?.hits?.length > 0) columnCount++;
  if (similarArtworks.siglip2?.hits?.length > 0) columnCount++;
  if (hasCombinedResults) columnCount++;
  
  // Determine grid columns based on column count
  let gridCols = 'md:grid-cols-2';
  if (columnCount >= 5) {
    gridCols = 'md:grid-cols-5';
  } else if (columnCount === 4) {
    gridCols = 'md:grid-cols-4';
  } else if (columnCount === 3) {
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
          responseTime={similarArtworks.metadata.took}
          totalResults={similarArtworks.metadata.total}
        />
      )}
      
      {/* 2. Jina v3 Text results */}
      {similarArtworks.jina_v3?.hits?.length > 0 && (
        <SearchResultColumn
          key="jina_v3"
          title={EMBEDDING_MODELS.jina_v3.name}
          description={EMBEDDING_MODELS.jina_v3.description}
          icon={FileText}
          hits={similarArtworks.jina_v3.hits || []}
          gradientFrom="from-blue-500"
          gradientTo="to-blue-600"
          badgeColor="bg-blue-700"
          responseTime={similarArtworks.jina_v3.took}
          totalResults={similarArtworks.jina_v3.total}
        />
      )}
      
      {/* 3. SigLIP 2 results */}
      {similarArtworks.siglip2?.hits?.length > 0 && (
        <SearchResultColumn
          key="siglip2"
          title={EMBEDDING_MODELS.siglip2.name}
          description={EMBEDDING_MODELS.siglip2.description}
          icon={Image}
          hits={similarArtworks.siglip2.hits || []}
          gradientFrom="from-purple-500"
          gradientTo="to-purple-600"
          badgeColor="bg-purple-700"
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
          responseTime={similarArtworks.combined.took}
          totalResults={similarArtworks.combined.total}
        />
      )}
      
      {/* 5. Pre-computed AI Curated results */}
      {hasPrecomputed && (
        <SearchResultColumn
          key="ai_curated"
          title="AI Curated"
          description="Selected by Gemini 2.5 Flash"
          icon={Brain}
          hits={precomputedHits}
          gradientFrom="from-indigo-500"
          gradientTo="to-indigo-600"
          badgeColor="bg-indigo-700"
          responseTime={0}
          totalResults={precomputedHits.length}
        />
      )}
    </div>
  );
}