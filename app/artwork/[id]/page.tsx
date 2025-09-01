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
import { Client } from '@elastic/elasticsearch';

// Initialize Elasticsearch client
const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || process.env.NEXT_PUBLIC_ELASTICSEARCH_INDEX || 'artworks_semantic';

interface PageProps {
  params: { id: string };
}

// Server function to fetch artwork details
async function getArtwork(id: string): Promise<Artwork | null> {
  try {
    const result = await client.get({
      index: INDEX_NAME,
      id,
      _source: {
        excludes: ['embeddings']
      }
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
    // First, we need to get the embeddings for this artwork
    const embeddingResult = await client.get({
      index: INDEX_NAME,
      id: artwork.metadata.id,
      _source: {
        includes: ['embeddings']
      }
    });

    if (!embeddingResult.found) {
      return results;
    }

    const embeddings = (embeddingResult._source as any).embeddings;
    if (!embeddings) {
      return results;
    }

    // Search for similar artworks for each model that has embeddings
    const searchPromises = Object.entries(embeddings).map(async ([modelKey, embedding]) => {
      if (!embedding || !Array.isArray(embedding)) {
        return null;
      }

      try {
        const searchResult = await client.search({
          index: INDEX_NAME,
          body: {
            knn: {
              field: `embeddings.${modelKey}`,
              query_vector: embedding as number[],
              k: 13, // +1 to exclude the source artwork
              num_candidates: 50
            },
            size: 13,
            _source: {
              excludes: ['embeddings']
            }
          }
        });

        // Filter out the source artwork from results
        const filteredHits = searchResult.hits.hits.filter(
          (hit: any) => hit._id !== artwork.metadata.id
        );

        return {
          model: modelKey,
          results: {
            took: searchResult.took,
            total: filteredHits.length,
            hits: filteredHits.slice(0, 12).map((hit: any) => ({
              _id: hit._id,
              _score: hit._score,
              _source: hit._source
            }))
          }
        };
      } catch (error) {
        console.error(`Error searching similar artworks for ${modelKey}:`, error);
        return null;
      }
    });

    const searchResults = await Promise.all(searchPromises);
    
    searchResults.forEach((result) => {
      if (result && result.model) {
        results[result.model] = result.results;
      }
    });

  } catch (error) {
    console.error('Error fetching similar artworks:', error);
  }

  return results;
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const artwork = await getArtwork(params.id);
  
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
      images: artwork.image?.url ? [artwork.image.url] : [],
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
  const artwork = await getArtwork(params.id);
  
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