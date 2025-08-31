import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Search, ExternalLink, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { Artwork, SearchResponse } from '@/app/types';
import SimilarArtworks from './SimilarArtworks';
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
      console.log('No embeddings found for artwork:', artwork.metadata.id);
      return results;
    }
    
    console.log('Found embeddings for models:', Object.keys(embeddings));

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
        console.log(`Got ${result.results.hits.length} similar artworks for ${result.model}`);
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

export default async function ArtworkDetailPage({ params }: PageProps) {
  const artwork = await getArtwork(params.id);
  
  if (!artwork) {
    notFound();
  }

  const similarArtworks = await getSimilarArtworks(artwork);
  console.log('Similar artworks results:', Object.keys(similarArtworks).map(key => ({
    model: key,
    count: similarArtworks[key]?.hits?.length || 0
  })));
  
  const { metadata, image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Back button */}
      <Link href="/">
        <Button variant="ghost" size="sm" className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Search
        </Button>
      </Link>

      {/* Compact artwork info card */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Image on left */}
            <div className="md:col-span-1">
              <div className="relative h-72 bg-muted rounded-lg overflow-hidden">
                <Image
                  src={imageUrl}
                  alt={metadata.title}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 33vw"
                  priority
                />
              </div>
            </div>
            
            {/* Metadata on right */}
            <div className="md:col-span-2 space-y-3">
              <h1 className="text-2xl font-bold">{metadata.title}</h1>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="font-semibold">Artist:</span>{' '}
                  {metadata.artist || 'Unknown'}
                </div>
                {metadata.date && (
                  <div>
                    <span className="font-semibold">Date:</span>{' '}
                    {metadata.date}
                  </div>
                )}
                {metadata.department && (
                  <div>
                    <span className="font-semibold">Department:</span>{' '}
                    {metadata.department}
                  </div>
                )}
                {metadata.classification && (
                  <div>
                    <span className="font-semibold">Classification:</span>{' '}
                    {metadata.classification}
                  </div>
                )}
                {metadata.artistNationality && (
                  <div>
                    <span className="font-semibold">Nationality:</span>{' '}
                    {metadata.artistNationality}
                  </div>
                )}
                {metadata.medium && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Medium:</span>{' '}
                    {metadata.medium}
                  </div>
                )}
                {metadata.dimensions && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Dimensions:</span>{' '}
                    {metadata.dimensions}
                  </div>
                )}
                {metadata.creditLine && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Credit Line:</span>{' '}
                    {metadata.creditLine}
                  </div>
                )}
              </div>
              
              {/* Artist bio if available */}
              {metadata.artistBio && (
                <div className="text-sm text-muted-foreground">
                  {metadata.artistBio}
                </div>
              )}

              {/* Museum link */}
              {metadata.sourceUrl && (
                <Button 
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={metadata.sourceUrl} target="_blank" rel="noopener noreferrer">
                    View on {metadata.collection === 'moma' ? 'MoMA' : 'Museum'} Website
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Similar artworks section */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Search className="w-5 h-5" />
          Similar Artworks
        </h2>
        
        <SimilarArtworks similarArtworks={similarArtworks} />
      </div>
    </div>
  );
}