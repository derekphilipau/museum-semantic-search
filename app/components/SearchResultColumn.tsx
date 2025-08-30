'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ArtworkCard from './ArtworkCard';
import { SearchHit } from '@/app/types';
import { LucideIcon } from 'lucide-react';

interface SearchResultColumnProps {
  title: string;
  description: string;
  icon: LucideIcon;
  hits: SearchHit[];
  gradientFrom: string;
  gradientTo: string;
  badgeColor?: string;
  onSelectArtwork: (artwork: any) => void;
  modelUrl?: string;
  showExternalLink?: boolean;
}

export default function SearchResultColumn({
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
        <div className="flex flex-col items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            <div>
              <CardTitle className="text-base">
                {modelUrl && showExternalLink ? (
                  <a 
                    href={modelUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    {title}
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
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