'use client';

import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Artwork } from '@/app/types';
import { getCollectionShortName } from '@/app/lib/collections';
import { Badge } from '@/components/ui/badge';

interface ArtworkDetailProps {
  artwork: Artwork;
}

export default function ArtworkDetail({ artwork }: ArtworkDetailProps) {
  const { metadata, image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;
  
  // Get institution name
  const institutionName = metadata.collection ? getCollectionShortName(metadata.collection) : '';

  return (
    <>
      {/* Compact artwork info card */}
      <Card className="mb-6">
        <CardContent className="">
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
              {institutionName && (
                <div className="text-lg font-medium text-muted-foreground">
                  {institutionName}
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="sm:col-span-2">
                  <span className="font-semibold">Artist:</span>{' '}
                  {metadata.artist || 'Unknown'}
                  {metadata.artistBio && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {metadata.artistBio}
                    </div>
                  )}
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

              {/* Museum link */}
              {metadata.sourceUrl && (
                <Button 
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={metadata.sourceUrl} target="_blank" rel="noopener noreferrer">
                    View on {institutionName || 'Museum'} Website
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI-generated descriptions */}
      {(artwork.visual_alt_text || artwork.visual_long_description || artwork.visual_emoji_summary) && (
        <Card className="mb-6">
          <CardContent className="">
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Visual Descriptions</h2>
                <Badge variant="secondary" className="text-base font-medium text-muted-foreground">AI Generated</Badge>
              </div>
              
              {artwork.visual_emoji_summary && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Visual Summary</h3>
                  <p className="text-3xl">{artwork.visual_emoji_summary}</p>
                </div>
              )}
              
              {artwork.visual_alt_text && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Brief Description</h3>
                  <p className="text-sm text-muted-foreground">{artwork.visual_alt_text}</p>
                </div>
              )}
              
              {artwork.visual_long_description && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Detailed Description</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{artwork.visual_long_description}</p>
                </div>
              )}
              
              {artwork.description_metadata && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Generated by {artwork.description_metadata.model}
                  {artwork.description_metadata.has_violations && (
                    <span className="text-orange-600 ml-2">
                      (Note: Some content guidelines were triggered during generation)
                    </span>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}