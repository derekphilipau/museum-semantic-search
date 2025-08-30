'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ArtworkCard from './ArtworkCard';
import { SearchHit, Artwork } from '@/app/types';
import { LucideIcon, ExternalLinkIcon } from 'lucide-react';

interface SearchResultColumnProps {
  title: string;
  description: string;
  icon: LucideIcon;
  hits: SearchHit[];
  gradientFrom: string;
  gradientTo: string;
  badgeColor?: string;
  onSelectArtwork: (artwork: Artwork) => void;
  modelUrl?: string;
  showExternalLink?: boolean;
}

function SearchResultColumn({
  title,
  description,
  icon: Icon,
  hits,
  gradientFrom,
  gradientTo,
  badgeColor,
  onSelectArtwork,
  modelUrl,
  showExternalLink = false,
}: SearchResultColumnProps) {
  return (
    <Card className="overflow-hidden py-0 h-full">
      <CardHeader className={`bg-gradient-to-r ${gradientFrom} ${gradientTo} text-white rounded-t-lg`}>
        <div className="flex flex-col items-center justify-between p-2 gap-2">
          <div className="flex flex-col items-center gap-2 pt-2">
            <Icon className="w-5 h-5" />
            <div className="text-center">
              <CardTitle className="text-base">
                {modelUrl && showExternalLink ? (
                  <a 
                    href={modelUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {title} <ExternalLinkIcon className="size-4 inline align-text-top ml-1" />
                  </a>
                ) : (
                  title
                )}
              </CardTitle>
              <CardDescription className="text-xs text-white/90">{description}</CardDescription>
            </div>
          </div>
          {hits.length > 0 && (
            <div className="flex gap-4">
              <div className="text-xs font-medium">{hits.length} results</div>
              {hits[0]?._score && (
                <div className="text-xs text-white/80">score: {hits[0]._score.toFixed(2)}</div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-3 overflow-hidden">
        {hits.length === 0 ? (
          <div className="text-muted-foreground text-sm">No results</div>
        ) : (
          <div className="space-y-2">
            {hits.slice(0, 10).map((hit, index) => (
              <div key={`${title}-${hit._id}-${index}`} className="relative h-full">
                <Badge 
                  variant={badgeColor === 'secondary' ? 'secondary' : 'default'}
                  className={`absolute -left-3 top-3 rounded-r-md rounded-l-none z-10 ${
                    badgeColor && badgeColor !== 'secondary' ? badgeColor : ''
                  }`}
                >
                  #{index + 1}
                </Badge>
                <ArtworkCard 
                  artwork={hit._source} 
                  score={hit._score}
                  onCompareClick={() => onSelectArtwork(hit._source)}
                  compact
                  showScore={true}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default React.memo(SearchResultColumn);