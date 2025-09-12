'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { EmbeddingVisualization } from './components/EmbeddingVisualization';
import { VisualizationControls } from './components/VisualizationControls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProjectionType, EmbeddingType, ColorByOption } from '@/app/types';
import debounce from 'lodash/debounce';

interface SearchResult {
  id: string;
  score: number;
}

export default function ExplorePage() {
  const [isMounted, setIsMounted] = useState(false);
  const [embeddingType, setEmbeddingType] = useState<EmbeddingType>('jina_v3');
  const [projectionType, setProjectionType] = useState<ProjectionType>('standard_2d');
  const [colorBy, setColorBy] = useState<ColorByOption>('artist');
  const [searchTerm, setSearchTerm] = useState('');
  const [artworkCount, setArtworkCount] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [maxScore, setMaxScore] = useState(1);
  const [isSearching, setIsSearching] = useState(false);
  
  // Ensure client-side only rendering
  useEffect(() => {
    setIsMounted(true);
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
        setMaxScore(data.maxScore || 1);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300),
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
          searchTerm={searchTerm}
          artworkCount={artworkCount}
          searchResultsCount={searchResults.length}
          isSearching={isSearching}
          onEmbeddingTypeChange={setEmbeddingType}
          onProjectionTypeChange={setProjectionType}
          onColorByChange={setColorBy}
          onSearchChange={setSearchTerm}
        />
      </div>
      
      {/* Visualization area */}
      <div className="flex-1 p-4 overflow-hidden">
        <ErrorBoundary>
          <EmbeddingVisualization
            embeddingType={embeddingType}
            projectionType={projectionType}
            colorBy={colorBy}
            searchResults={searchResults}
            maxScore={maxScore}
            onDataLoaded={setArtworkCount}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}