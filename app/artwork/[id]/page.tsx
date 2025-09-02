import { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { Artwork, SearchResponse } from '@/app/types';
import SimilarArtworks from './SimilarArtworks';
import ArtworkDetail from './ArtworkDetail';
import ScrollToTop from '@/app/components/ScrollToTop';
import { Skeleton } from '@/components/ui/skeleton';
import { getElasticsearchClient, INDEX_NAME, findSimilarArtworks, findCombinedSimilarArtworks, findMetadataSimilarArtworks } from '@/lib/elasticsearch/client';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Server function to fetch artwork details
async function getArtwork(id: string): Promise<Artwork | null> {
  try {
    const client = getElasticsearchClient();
    const result = await client.get({
      index: INDEX_NAME,
      id,
      _source_excludes: ['embeddings']
    });

    if (!result.found) {
      return null;
    }

    return result._source as Artwork;
  } catch (error) {
    console.error('Error fetching artwork:', error);
    return null;
  }
}

// Server function to fetch similar artworks for all models
async function getSimilarArtworks(artwork: Artwork): Promise<Record<string, SearchResponse>> {
  const results: Record<string, SearchResponse> = {};
  
  try {
    // Get similar artworks for each individual model
    const modelKeys = Object.keys(EMBEDDING_MODELS) as ModelKey[];
    const individualSearchPromises = modelKeys.map(async (modelKey) => {
      try {
        const result = await findSimilarArtworks(artwork.metadata.id, modelKey, 12);
        return { model: modelKey, result };
      } catch {
        console.log(`No ${modelKey} embeddings for artwork ${artwork.metadata.id}`);
        return { model: modelKey, result: { took: 0, total: 0, hits: [] } };
      }
    });

    // Also get combined similarity results (now includes metadata)
    const combinedPromise = findCombinedSimilarArtworks(
      artwork.metadata.id, 
      modelKeys,
      12,
      { jina_v3: 0.35, siglip2: 0.35, metadata: 0.3 } // Balanced weights across all similarity types
    ).catch(error => {
      console.log(`Combined similarity search failed for artwork ${artwork.metadata.id}:`, error);
      return { took: 0, total: 0, hits: [] };
    });
    
    // Also get metadata-based similarity
    const metadataPromise = findMetadataSimilarArtworks(
      artwork.metadata.id,
      12
    ).catch(error => {
      console.log(`Metadata similarity search failed for artwork ${artwork.metadata.id}:`, error);
      return { took: 0, total: 0, hits: [] };
    });

    // Execute all searches in parallel
    const [individualResults, combinedResult, metadataResult] = await Promise.all([
      Promise.all(individualSearchPromises),
      combinedPromise,
      metadataPromise
    ]);

    // Process individual model results
    individualResults.forEach(({ model, result }) => {
      results[model] = result;
    });

    // Add combined and metadata results
    results['combined'] = combinedResult;
    results['metadata'] = metadataResult;
  } catch (error) {
    console.error('Error fetching similar artworks:', error);
  }

  return results;
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const artwork = await getArtwork(id);
  
  if (!artwork) {
    return {
      title: 'Artwork Not Found',
    };
  }

  const { metadata } = artwork;
  
  return {
    title: `${metadata.title} by ${metadata.artist || 'Unknown Artist'}`,
    description: `${metadata.classification || 'Artwork'} from ${metadata.date || 'Unknown date'}. ${metadata.medium || ''}`,
    openGraph: {
      title: metadata.title,
      description: `by ${metadata.artist || 'Unknown Artist'}`,
      images: typeof artwork.image === 'string' ? [artwork.image] : artwork.image?.url ? [artwork.image.url] : [],
    },
  };
}

// Component to load and display similar artworks
async function SimilarArtworksSection({ artwork }: { artwork: Artwork }) {
  const similarArtworks = await getSimilarArtworks(artwork);
  
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Search className="w-5 h-5" />
        Similar Artworks
      </h2>
      
      <SimilarArtworks similarArtworks={similarArtworks} />
    </div>
  );
}

export default async function ArtworkDetailPage({ params }: PageProps) {
  const { id } = await params;
  const artwork = await getArtwork(id);
  
  if (!artwork) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <ScrollToTop />
      <ArtworkDetail artwork={artwork} />
      
      <Suspense fallback={
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-6 w-40" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="bg-gradient-to-r from-gray-200 to-gray-300 rounded-t-lg p-4">
                  <Skeleton className="h-5 w-32 mx-auto mb-2" />
                  <Skeleton className="h-3 w-48 mx-auto" />
                </div>
                <div className="p-3 space-y-2">
                  {[...Array(3)].map((_, j) => (
                    <Skeleton key={j} className="h-16 w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }>
        <SimilarArtworksSection artwork={artwork} />
      </Suspense>
    </div>
  );
}