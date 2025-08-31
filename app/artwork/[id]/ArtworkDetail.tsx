'use client';

import Image from 'next/image';
import { ExternalLink, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Artwork } from '@/app/types';

interface ArtworkDetailProps {
  artwork: Artwork;
}

export default function ArtworkDetail({ artwork }: ArtworkDetailProps) {
  const { metadata, image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;

  return (
    <>
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
    </>
  );
}