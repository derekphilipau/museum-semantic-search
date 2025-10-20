'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { EmbeddingVisualization } from './components/EmbeddingVisualization';
import { VisualizationControls } from './components/VisualizationControls';
import { SearchResultsPanel } from './components/SearchResultsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProjectionType, EmbeddingType, ColorByOption, DisplayMode } from '@/app/types';
import debounce from 'lodash/debounce';

interface SearchResult {
  id: string;
  score: number;
  artwork?: {
    id: string;
    title: string;
    artist?: string;
    date?: string;
    primaryImageSmall?: string;
    medium?: string;
    department?: string;
  };
}

export default function ExplorePage() {
  const [isMounted, setIsMounted] = useState(false);
  const [embeddingType, setEmbeddingType] = useState<EmbeddingType>('jina_text');
  const [projectionType, setProjectionType] = useState<ProjectionType>('standard_2d');
  const [colorBy, setColorBy] = useState<ColorByOption>('artist');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('points');
  const [searchTerm, setSearchTerm] = useState('');
  const [artworkCount, setArtworkCount] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredArtworkId, setHoveredArtworkId] = useState<string | null>(null);
  
  // Check if mobile on mount
  useEffect(() => {
    setIsMounted(true);
    // Default to expanded on desktop
    const checkScreenSize = () => {
      setIsExpanded(window.innerWidth >= 1024);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);
  
  // Debounced search function
  const performSearch = useMemo(
    () => debounce(async (query: string, embeddingType: EmbeddingType) => {
      if (!query.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/visualize/search?query=${encodeURIComponent(query)}&embeddingType=${embeddingType}`
        );
        const data = await response.json();
        
        setSearchResults(data.hits || []);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );
  
  // Trigger search when search term or embedding type changes
  useEffect(() => {
    performSearch(searchTerm, embeddingType);
  }, [searchTerm, embeddingType, performSearch]);
  
  // Show loading state until client-side hydration is complete
  if (!isMounted) {
    return null; // Will use loading.tsx
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] relative overflow-hidden">
      {/* Horizontal controls bar - sticky */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <VisualizationControls
          embeddingType={embeddingType}
          projectionType={projectionType}
          colorBy={colorBy}
          displayMode={displayMode}
          searchTerm={searchTerm}
          artworkCount={artworkCount}
          searchResultsCount={searchResults.length}
          isSearching={isSearching}
          onEmbeddingTypeChange={setEmbeddingType}
          onProjectionTypeChange={setProjectionType}
          onColorByChange={setColorBy}
          onDisplayModeChange={setDisplayMode}
          onSearchChange={setSearchTerm}
        />
      </div>
      
      {/* Main content area with visualization and results */}
      <div className="flex-1 flex overflow-hidden">
        {/* Visualization area */}
        <div className="flex-1 p-4 overflow-hidden">
          <ErrorBoundary>
            <EmbeddingVisualization
              embeddingType={embeddingType}
              projectionType={projectionType}
              colorBy={colorBy}
              displayMode={displayMode}
              searchResults={searchResults.map(r => ({ id: r.id, score: r.score }))}
              onDataLoaded={setArtworkCount}
              highlightedArtworkId={hoveredArtworkId}
            />
          </ErrorBoundary>
        </div>
        
        {/* Search results sidebar */}
        {searchTerm && (
          <div className={`border-l bg-background overflow-hidden transition-all duration-300 ${
            isExpanded ? 'w-96' : 'w-32'
          }`}>
            <SearchResultsPanel
              searchResults={searchResults}
              searchTerm={searchTerm}
              isSearching={isSearching}
              artworks={searchResults
                .map(r => r.artwork)
                .filter((artwork): artwork is NonNullable<typeof artwork> => artwork !== undefined)}
              isExpanded={isExpanded}
              onToggleExpanded={() => setIsExpanded(!isExpanded)}
              onHoverArtwork={setHoveredArtworkId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
