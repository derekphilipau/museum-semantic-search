'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';

interface SearchResult {
  id: string;
  score: number;
}

interface PartialArtwork {
  id: string;
  title: string;
  artist?: string;
  date?: string;
  primaryImageSmall?: string;
  medium?: string;
  department?: string;
}

interface SearchResultsPanelProps {
  searchResults: SearchResult[];
  searchTerm: string;
  isSearching: boolean;
  artworks?: PartialArtwork[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onHoverArtwork?: (artworkId: string | null) => void;
}

const RESULTS_PER_PAGE = 50;
const THUMBNAILS_PER_PAGE = 6;

export function SearchResultsPanel({
  searchResults,
  searchTerm,
  isSearching,
  artworks = [],
  isExpanded,
  onToggleExpanded,
  onHoverArtwork
}: SearchResultsPanelProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [thumbnailPage, setThumbnailPage] = useState(1);
  
  // Create a map for quick artwork lookup
  const artworkMap = useMemo(() => {
    const map = new Map<string, PartialArtwork>();
    artworks.forEach(artwork => {
      map.set(artwork.id, artwork);
    });
    return map;
  }, [artworks]);
  
  // Calculate pagination for expanded view
  const totalPages = Math.ceil(searchResults.length / RESULTS_PER_PAGE);
  const startIndex = (currentPage - 1) * RESULTS_PER_PAGE;
  const endIndex = startIndex + RESULTS_PER_PAGE;
  const currentResults = searchResults.slice(startIndex, endIndex);
  
  // Calculate pagination for contracted view
  const totalThumbnailPages = Math.ceil(searchResults.length / THUMBNAILS_PER_PAGE);
  const thumbnailStartIndex = (thumbnailPage - 1) * THUMBNAILS_PER_PAGE;
  const thumbnailEndIndex = thumbnailStartIndex + THUMBNAILS_PER_PAGE;
  const thumbnailResults = searchResults.slice(thumbnailStartIndex, thumbnailEndIndex);
  
  // Reset pages when search changes
  React.useEffect(() => {
    setCurrentPage(1);
    setThumbnailPage(1);
  }, [searchTerm]);
  
  if (!searchTerm && searchResults.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <p className="text-muted-foreground text-center text-sm">
          Search to see results
        </p>
      </div>
    );
  }
  
  if (isSearching) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">Searching...</p>
      </div>
    );
  }
  
  if (searchResults.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <p className="text-muted-foreground text-center text-sm">
          No results found for &ldquo;{searchTerm}&rdquo;
        </p>
      </div>
    );
  }
  
  // Contracted view - thumbnail strip
  if (!isExpanded) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-xs">{searchResults.length} results</h3>
            <p className="text-xs text-muted-foreground">
              {thumbnailStartIndex + 1}-{Math.min(thumbnailEndIndex, searchResults.length)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleExpanded}
            className="h-8 w-8"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
        
        {/* Thumbnail grid */}
        <div className="flex-1 p-3 space-y-2">
          {thumbnailResults.map((result) => {
            const artwork = artworkMap.get(result.id);
            if (!artwork) return null;
            
            return (
              <Link
                key={result.id}
                href={`/artwork/${artwork.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div 
                  className="relative w-full aspect-square rounded overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                  onMouseEnter={() => onHoverArtwork?.(artwork.id)}
                  onMouseLeave={() => onHoverArtwork?.(null)}
                >
                  {artwork.primaryImageSmall ? (
                    <Image
                      src={artwork.primaryImageSmall}
                      alt={artwork.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 80px, 120px"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No image</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
        
        {/* Pagination */}
        {totalThumbnailPages > 1 && (
          <div className="p-3 border-t flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setThumbnailPage(p => Math.max(1, p - 1))}
              disabled={thumbnailPage === 1}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <span className="text-xs text-muted-foreground">
              {thumbnailPage}/{totalThumbnailPages}
            </span>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setThumbnailPage(p => Math.min(totalThumbnailPages, p + 1))}
              disabled={thumbnailPage === totalThumbnailPages}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  }
  
  // Expanded view - detailed list
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">
            {searchResults.length} results for &ldquo;{searchTerm}&rdquo;
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Showing {startIndex + 1}-{Math.min(endIndex, searchResults.length)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleExpanded}
          className="h-8 w-8"
        >
          <Minimize2 className="h-3 w-3" />
        </Button>
      </div>
      
      {/* Results list */}
      <div className="flex-1 flex flex-col overflow-y-auto p-2 space-y-2 sm:space-y-2">
        {currentResults.map((result, index) => {
          const artwork = artworkMap.get(result.id);
          if (!artwork) return null;
          
          const globalIndex = startIndex + index + 1;
          const relevancePercent = Math.round((result.score / searchResults[0].score) * 100);
          
          return (
            <Link
              key={result.id}
              href={`/artwork/${artwork.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Card 
                className="p-3 hover:shadow-md transition-shadow cursor-pointer"
                onMouseEnter={() => onHoverArtwork?.(artwork.id)}
                onMouseLeave={() => onHoverArtwork?.(null)}
              >
                <div className="flex gap-2">
                  {/* Thumbnail */}
                  {artwork.primaryImageSmall && (
                    <div className="relative w-16 h-16 flex-shrink-0">
                      <Image
                        src={artwork.primaryImageSmall}
                        alt={artwork.title}
                        fill
                        className="object-cover rounded"
                        sizes="64px"
                        unoptimized
                      />
                    </div>
                  )}
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium line-clamp-2">
                          {artwork.title}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          {artwork.artist || 'Unknown Artist'}
                          {artwork.date && `, ${artwork.date}`}
                        </p>
                      </div>
                      <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                    
                    {/* Rank and relevance */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs font-medium">#{globalIndex}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all"
                          style={{ width: `${relevancePercent}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{relevancePercent}%</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}