'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { Artwork, SearchResponse } from '@/app/types';
import ArtworkCard from './ArtworkCard';

interface ArtworkDetailModalProps {
  artwork: Artwork | null;
  open: boolean;
  onClose: () => void;
}

export default function ArtworkDetailModal({ artwork, open, onClose }: ArtworkDetailModalProps) {
  const [similarResults, setSimilarResults] = useState<Record<string, SearchResponse>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (artwork && open) {
      searchSimilarArtworks();
    }
  }, [artwork, open]);

  const searchSimilarArtworks = async () => {
    if (!artwork) return;
    
    setLoading(true);
    try {
      // Search for similar artworks using each model
      const modelKeys = Object.keys(EMBEDDING_MODELS);
      const searchPromises = modelKeys.map(async (modelKey) => {
        const response = await fetch('/api/search/similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objectId: artwork.metadata.objectId,
            model: modelKey,
            size: 10
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
      setLoading(false);
    }
  };

  if (!artwork) return null;

  const { metadata, image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;
  const fullImageUrl = imageUrl.startsWith('/images/') ? imageUrl : `/images/${imageUrl}`;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="!max-w-[90vw] !w-[1400px] max-h-[90vh] overflow-y-auto sm:!max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="text-2xl">{metadata.title}</DialogTitle>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left side - Artwork details */}
          <div className="space-y-4">
            <div className="relative h-96 bg-muted rounded-lg overflow-hidden">
              <Image
                src={fullImageUrl}
                alt={metadata.title}
                fill
                className="object-contain p-4"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>
            
            <div className="space-y-2">
              <div>
                <span className="font-semibold">Artist:</span> {metadata.artist || 'Unknown'}
              </div>
              {metadata.dateCreated && (
                <div>
                  <span className="font-semibold">Date:</span> {metadata.dateCreated}
                </div>
              )}
              {metadata.department && (
                <div>
                  <span className="font-semibold">Department:</span> {metadata.department}
                </div>
              )}
              {metadata.culture && (
                <div>
                  <span className="font-semibold">Culture:</span> {metadata.culture}
                </div>
              )}
              {metadata.medium && (
                <div>
                  <span className="font-semibold">Medium:</span> {metadata.medium}
                </div>
              )}
              {metadata.dimensions && (
                <div>
                  <span className="font-semibold">Dimensions:</span> {metadata.dimensions}
                </div>
              )}
              {metadata.creditLine && (
                <div>
                  <span className="font-semibold">Credit Line:</span> {metadata.creditLine}
                </div>
              )}
            </div>
            
            <Button 
              onClick={() => window.open(`https://www.metmuseum.org/art/collection/search/${metadata.objectId}`, '_blank')}
              variant="outline"
              className="w-full"
            >
              View on Met Museum Website
            </Button>
          </div>
          
          {/* Right side - Similar artworks */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Search className="w-5 h-5" />
              Similar Artworks
            </h3>
            
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Searching for similar artworks...
              </div>
            ) : (
              <Tabs defaultValue={Object.keys(EMBEDDING_MODELS)[0]} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  {Object.entries(EMBEDDING_MODELS).map(([key, model]) => (
                    <TabsTrigger key={key} value={key}>
                      {model.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                {Object.entries(EMBEDDING_MODELS).map(([key, model]) => (
                  <TabsContent key={key} value={key} className="mt-4">
                    <div className="space-y-2">
                      {similarResults[key]?.hits.slice(0, 6).map((hit, index) => (
                        <div key={hit._id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                          <Badge variant="secondary" className="mt-1">
                            #{index + 1}
                          </Badge>
                          <div className="flex-1">
                            <div className="font-medium text-sm">{hit._source.metadata.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {hit._source.metadata.artist || 'Unknown artist'}
                            </div>
                            {hit._score && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Score: {hit._score.toFixed(3)}
                              </div>
                            )}
                          </div>
                          <div className="relative w-16 h-16 bg-muted rounded overflow-hidden">
                            <Image
                              src={`/images/${hit._source.image}`}
                              alt={hit._source.metadata.title}
                              fill
                              className="object-cover"
                              sizes="64px"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}