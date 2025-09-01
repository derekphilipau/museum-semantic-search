'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Artwork } from '@/app/types';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

interface ArtworkCardProps {
  artwork: Artwork;
  score?: number;
  showScore?: boolean;
  rank?: number;
  compact?: boolean;
  onCompareClick?: () => void;
}

function ArtworkCard({
  artwork,
  score,
  showScore = false,
  rank,
  compact = false,
  onCompareClick,
}: ArtworkCardProps) {
  const { metadata, image } = artwork;
  // Handle both full image objects and simple string URLs
  const imageUrl = typeof image === 'string' ? image : image.url;

  // Compact version for multi-column layout
  if (compact) {
    return (
      <Link href={`/artwork/${metadata.id}`} className="block h-full">
        <Card 
          className="overflow-hidden cursor-pointer hover:shadow-lg transition-all w-full h-full flex flex-col p-2"
        >
        <CardContent className="p-0 flex flex-col h-full gap-2">
          {/* Image - fixed height container */}
          <div className="h-56 rounded-md bg-muted/50 relative overflow-hidden flex items-center justify-center">
            <Image
              src={imageUrl}
              alt={metadata.title}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 280px"
            />
          </div>
          
          {/* Content section - flex-grow to push score to bottom */}
          <div className="flex-grow flex flex-col">
            {/* Title */}
            <CardTitle className="text-sm mb-1 line-clamp-2 break-words">
              {metadata.title}
            </CardTitle>
            
            {/* Artist */}
            <CardDescription className="text-xs mb-2 line-clamp-1">
              {metadata.artist || 'Unknown artist'}
            </CardDescription>
            
            {/* Classification, Date, and Medium - optional, takes available space */}
            <div className="text-xs text-muted-foreground space-y-0.5 flex-grow">
              {metadata.classification && (
                <div className="line-clamp-1 font-medium">{metadata.classification}</div>
              )}
              {metadata.date && (
                <div>{metadata.date}</div>
              )}
              {metadata.medium && (
                <div className="line-clamp-1">{metadata.medium}</div>
              )}
              {/* AI-generated alt text */}
              {artwork.visual_alt_text && (
                <div className="mt-1 pt-1 border-t">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="bg-muted px-1 py-0.5 rounded text-[10px] font-medium">AI</span>
                    <span className="line-clamp-2 italic">{artwork.visual_alt_text}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Score - always at bottom */}
          {showScore && score !== undefined && (
            <div className="flex items-center justify-between pt-2 mt-auto border-t">
              <span className="text-xs text-muted-foreground">Score</span>
              <span className="text-xs font-mono font-semibold">{score.toFixed(3)}</span>
            </div>
          )}
        </CardContent>
        </Card>
      </Link>
    );
  }

  // Full version
  return (
    <Link href={`/artwork/${metadata.objectId}`} className="block h-full">
      <Card 
        className="overflow-hidden cursor-pointer hover:shadow-lg transition-all h-full flex flex-col"
      >
      <CardContent className="p-4 flex flex-col h-full">
        {rank && (
          <div className="text-xs text-muted-foreground mb-2">Rank #{rank}</div>
        )}
        
        {/* Image - fixed height container */}
        <div className="h-64 rounded-md bg-muted/50 mb-3 relative overflow-hidden flex items-center justify-center">
          <Image
            src={imageUrl}
            alt={metadata.title}
            fill
            className="object-contain p-3"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw"
          />
        </div>
        
        {/* Content section - flex-grow to fill available space */}
        <div className="flex-grow flex flex-col">
          {/* Title */}
          <CardTitle className="text-base mb-1 line-clamp-2 break-words">
            {metadata.title}
          </CardTitle>
          
          {/* Artist */}
          <CardDescription className="text-sm mb-2 line-clamp-1">
            {metadata.artist || 'Unknown artist'}
          </CardDescription>
          
          {/* Metadata - takes available space */}
          <div className="text-xs text-muted-foreground space-y-1 flex-grow">
            {metadata.date && (
              <div>{metadata.date}</div>
            )}
            {metadata.classification && (
              <div className="font-medium">{metadata.classification}</div>
            )}
            {metadata.department && (
              <div className="line-clamp-1">{metadata.department}</div>
            )}
            {metadata.medium && (
              <div className="line-clamp-2 text-xs">{metadata.medium}</div>
            )}
            {/* AI-generated description */}
            {artwork.visual_alt_text && (
              <div className="mt-2 pt-2 border-t">
                <div className="inline-flex items-start gap-1.5 text-xs">
                  <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5">AI</span>
                  <span className="line-clamp-3 italic text-muted-foreground">{artwork.visual_alt_text}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Score - always at bottom */}
        {showScore && score !== undefined && (
          <div className="flex items-center justify-between pt-3 mt-auto border-t">
            <span className="text-sm text-muted-foreground">Relevance Score</span>
            <span className="text-sm font-mono font-semibold">{score.toFixed(3)}</span>
          </div>
        )}
      </CardContent>
      </Card>
    </Link>
  );
}

export default ArtworkCard;