'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Search, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { Artwork, SearchResponse } from '@/app/types';
import SearchResultColumn from '@/app/components/SearchResultColumn';
import { Brain } from 'lucide-react';

export default function ArtworkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const objectId = parseInt(params.id as string);
  
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [similarResults, setSimilarResults] = useState<Record<string, SearchResponse>>({});
  const [loading, setLoading] = useState(true);
  const [similarLoading, setSimilarLoading] = useState(false);

  useEffect(() => {
    if (objectId) {
      fetchArtwork();
    }
  }, [objectId]);

  useEffect(() => {
    if (artwork) {
      searchSimilarArtworks();
    }
  }, [artwork]);

  const fetchArtwork = async () => {
    try {
      const response = await fetch('/api/artwork/' + objectId);
      if (response.ok) {
        const data = await response.json();
        setArtwork(data);
      } else {
        console.error('Failed to fetch artwork');
      }
    } catch (error) {
      console.error('Error fetching artwork:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchSimilarArtworks = async () => {
    if (!artwork) return;
    
    setSimilarLoading(true);
    try {
      const modelKeys = Object.keys(EMBEDDING_MODELS);
      const searchPromises = modelKeys.map(async (modelKey) => {
        const response = await fetch('/api/search/similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objectId: artwork.metadata.objectId,
            model: modelKey,
            size: 12
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          return { model: modelKey, results: data };
        }
        return null;
      });
      
      const results = await Promise.all(searchPromises);
      const newSimilarResults: Record<string, SearchResponse> = {};
      
      results.forEach((result) => {
        if (result) {
          newSimilarResults[result.model] = result.results;
        }
      });
      
      setSimilarResults(newSimilarResults);
    } catch (error) {
      console.error('Error searching similar artworks:', error);
    } finally {
      setSimilarLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="h-96" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  if (!artwork) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">Artwork not found</p>
          <Button onClick={() => router.push('/')}>
            Back to Search
          </Button>
        </Card>
      </div>
    );
  }

  const { metadata, image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;
  const fullImageUrl = imageUrl.startsWith('/images/') ? imageUrl : `/images/${imageUrl}`;

  // Dummy function for SearchResultColumn compatibility
  const handleSelectArtwork = () => {};

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Compact artwork info card */}
      <Card className="mb-6">
        <CardContent className="">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Image on left */}
            <div className="md:col-span-1">
              <div className="relative h-72 bg-muted rounded-lg overflow-hidden">
                <Image
                  src={fullImageUrl}
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
                {metadata.dateCreated && (
                  <div>
                    <span className="font-semibold">Date:</span>{' '}
                    {metadata.dateCreated}
                  </div>
                )}
                {metadata.department && (
                  <div>
                    <span className="font-semibold">Department:</span>{' '}
                    {metadata.department}
                  </div>
                )}
                {metadata.culture && (
                  <div>
                    <span className="font-semibold">Culture:</span>{' '}
                    {metadata.culture}
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
              
              {metadata.tags && metadata.tags.length > 0 && (
                <div>
                  <span className="font-semibold text-sm">Tags:</span>{' '}
                  <div className="flex flex-wrap gap-2 mt-1">
                    {metadata.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Met Museum link */}
              <Button 
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://www.metmuseum.org/art/collection/search/${metadata.objectId}`, '_blank')}
              >
                View on Met Museum
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>

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
        
        {similarLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(2)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-48" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(EMBEDDING_MODELS).map(([modelKey, model]) => {
              const results = similarResults[modelKey];
              if (!results) return null;
              
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
                  onSelectArtwork={handleSelectArtwork}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}