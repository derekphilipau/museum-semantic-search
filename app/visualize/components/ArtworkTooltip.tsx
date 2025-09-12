'use client';

import React from 'react';
import { ProjectionPoint } from '@/app/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ArtworkTooltipProps {
  point: ProjectionPoint;
  children: React.ReactNode;
  open: boolean;
}

export function ArtworkTooltip({ point, children, open }: ArtworkTooltipProps) {
  const metadata = point.metadata;
  
  // Image URL is already provided in metadata
  
  return (
    <TooltipProvider>
      <Tooltip open={open} delayDuration={0}>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent 
          side="right" 
          align="start"
          className="max-w-md p-4 space-y-3"
          sideOffset={5}
        >
          {/* Title and basic info */}
          <div>
            <h3 className="font-semibold text-sm">{metadata.title || 'Untitled'}</h3>
            {metadata.artist && (
              <p className="text-sm text-muted-foreground">{metadata.artist}</p>
            )}
            {metadata.date && (
              <p className="text-sm text-muted-foreground">{metadata.date}</p>
            )}
            {metadata.medium && (
              <p className="text-sm text-muted-foreground">{metadata.medium}</p>
            )}
          </div>
          
          {/* Tags */}
          {metadata.tags && metadata.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.tags.map((tag, i) => (
                <span 
                  key={i} 
                  className="text-xs bg-secondary px-2 py-1 rounded-md"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          {/* Visual description */}
          {metadata.alt_text && (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">Visual Description</p>
              <p className="text-sm">{metadata.alt_text}</p>
            </div>
          )}
          
          {/* Artwork ID */}
          <p className="text-xs text-muted-foreground">ID: {point.artwork_id}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}