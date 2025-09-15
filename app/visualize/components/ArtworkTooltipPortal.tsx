'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProjectionPoint } from '@/app/types';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ArtworkTooltipProps {
  point: ProjectionPoint;
  mousePos: { x: number; y: number };
}

export function ArtworkTooltip({ point, mousePos }: ArtworkTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const metadata = point.metadata;
  
  // Get proper image URL
  let imageUrl = '';
  if (typeof metadata.image === 'string') {
    imageUrl = metadata.image;
  } else if (metadata.image?.thumbnailUrl) {
    imageUrl = metadata.image.thumbnailUrl;
  } else if (metadata.image?.url) {
    imageUrl = metadata.image.url;
  }
  const hasValidImage = imageUrl && imageUrl.startsWith('https://');
  
  // Get visual description data
  const altText = metadata.alt_text;
  const longDescription = null; // long_description not available in projection data
  
  // Calculate position to keep tooltip within viewport
  useEffect(() => {
    if (!tooltipRef.current) return;
    
    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();
    const padding = 10;
    
    let x = mousePos.x + padding;
    let y = mousePos.y + padding;
    
    // Check right edge
    if (x + rect.width > window.innerWidth - padding) {
      x = mousePos.x - rect.width - padding;
    }
    
    // Check bottom edge
    if (y + rect.height > window.innerHeight - padding) {
      y = mousePos.y - rect.height - padding;
    }
    
    // Check left edge
    if (x < padding) {
      x = padding;
    }
    
    // Check top edge
    if (y < padding) {
      y = padding;
    }
    
    setPosition({ x, y });
  }, [mousePos]);
  
  return createPortal(
    <Card
      ref={tooltipRef}
      className="fixed z-50 pointer-events-none shadow-lg border bg-background/95 backdrop-blur py-0"
      style={{
        left: position.x,
        top: position.y,
        maxWidth: '450px',
        maxHeight: '400px'
      }}
    >
      <ScrollArea className="max-h-[380px]">
        <div className="p-4 space-y-3">
          {/* Image and title/metadata side by side */}
          <div className="flex gap-3">
            {/* Image on the left */}
            {hasValidImage && (
              <div className="flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={metadata.title}
                  className="rounded-md object-cover w-32 h-32"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            {/* Title and basic info on the right */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base leading-tight">
                {metadata.title || 'Untitled'}
              </h3>
              {metadata.artist && (
                <p className="text-sm text-muted-foreground mt-1">{metadata.artist}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-2 text-sm text-muted-foreground">
                {metadata.date && <span>{metadata.date}</span>}
                {metadata.date && metadata.medium && <span>•</span>}
                {metadata.medium && <span>{metadata.medium}</span>}
              </div>
              
              {/* Tags */}
              {metadata.tags && metadata.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {metadata.tags.slice(0, 3).map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {metadata.tags.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{metadata.tags.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Visual descriptions */}
          {(altText || longDescription) && (
            <>
              <Separator />
              <div className="space-y-2">
                {altText && (
                  <div className="inline-flex items-center gap-2">
                    <Badge variant="secondary" className="size-5 text-xs font-medium text-muted-foreground">AI</Badge>
                    <p className="text-sm italic">{altText}</p>
                  </div>
                )}
                
                {longDescription && (
                  <div className="inline-flex items-center gap-2">
                    <Badge variant="secondary" className="size-5 text-xs font-medium text-muted-foreground">AI</Badge>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {longDescription}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </Card>,
    document.body
  );
}