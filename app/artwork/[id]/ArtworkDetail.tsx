'use client';

import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Artwork } from '@/app/types';
import { getCollectionShortName } from '@/app/lib/collections';
import { Badge } from '@/components/ui/badge';
import ClickableEmojis from '@/app/components/ClickableEmojis';
import PromptCollapsible from '@/app/components/PromptCollapsible';

interface ArtworkDetailProps {
  artwork: Artwork;
}

export default function ArtworkDetail({ artwork }: ArtworkDetailProps) {
  const { image } = artwork;
  const imageUrl = typeof image === 'string' ? image : image.url;
  
  // Get institution name
  const institutionName = artwork.collection ? getCollectionShortName(artwork.collection) : '';

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
                  alt={artwork.title}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 33vw"
                  priority
                />
              </div>
            </div>
            
            {/* Metadata on right */}
            <div className="md:col-span-2 space-y-3">
              <h1 className="text-2xl font-bold">{artwork.title}</h1>
              {institutionName && (
                <div className="text-lg font-medium text-muted-foreground">
                  {institutionName}
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="sm:col-span-2">
                  <span className="font-semibold">Artist:</span>{' '}
                  {artwork.artist || 'Unknown'}
                  {artwork.artistBio && (
                    <span className="text-sm text-muted-foreground ml-1">
                      ({artwork.artistBio})
                    </span>
                  )}
                </div>
                {artwork.date && (
                  <div>
                    <span className="font-semibold">Date:</span>{' '}
                    {artwork.date}
                  </div>
                )}
                {artwork.department && (
                  <div>
                    <span className="font-semibold">Department:</span>{' '}
                    {artwork.department}
                  </div>
                )}
                {artwork.classification && (
                  <div>
                    <span className="font-semibold">Classification:</span>{' '}
                    {artwork.classification}
                  </div>
                )}
                {artwork.medium && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Medium:</span>{' '}
                    {artwork.medium}
                  </div>
                )}
                {artwork.dimensions && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Dimensions:</span>{' '}
                    {artwork.dimensions}
                  </div>
                )}
                {artwork.creditLine && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Credit Line:</span>{' '}
                    {artwork.creditLine}
                  </div>
                )}
              </div>

              {/* Museum link */}
              {artwork.sourceUrl && (
                <Button 
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={artwork.sourceUrl} target="_blank" rel="noopener noreferrer">
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
      {artwork.visual_description && (
        <Card className="mb-6">
          <CardContent className="">
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Visual Descriptions</h2>
                <Badge variant="secondary" className="text-base font-medium text-muted-foreground">AI Generated</Badge>
              </div>
              
              {artwork.visual_description.emoji_summary && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Visual Summary</h3>
                  <ClickableEmojis emojis={artwork.visual_description.emoji_summary} size="3xl" />
                </div>
              )}
              
              {artwork.visual_description.alt_text && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Brief Description</h3>
                  <p className="text-sm text-muted-foreground">{artwork.visual_description.alt_text}</p>
                </div>
              )}
              
              {artwork.visual_description.long_description && (
                <div>
                  <h3 className="font-semibold text-sm mb-1">Detailed Description</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{artwork.visual_description.long_description}</p>
                </div>
              )}
              
              {artwork.visual_description.metadata && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Generated by {artwork.visual_description.metadata.model}
                </div>
              )}
              
              <PromptCollapsible />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}