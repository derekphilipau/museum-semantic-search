'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Palette, Layers, SlidersHorizontal, Circle, Image } from 'lucide-react';
import { ProjectionType, EmbeddingType, ColorByOption, DisplayMode } from '@/app/types';

interface VisualizationControlsProps {
  embeddingType: EmbeddingType;
  projectionType: ProjectionType;
  colorBy: ColorByOption;
  displayMode: DisplayMode;
  searchTerm: string;
  artworkCount: number;
  searchResultsCount?: number;
  isSearching?: boolean;
  onEmbeddingTypeChange: (value: EmbeddingType) => void;
  onProjectionTypeChange: (value: ProjectionType) => void;
  onColorByChange: (value: ColorByOption) => void;
  onDisplayModeChange: (value: DisplayMode) => void;
  onSearchChange: (value: string) => void;
}

export function VisualizationControls({
  embeddingType,
  projectionType,
  colorBy,
  displayMode,
  searchTerm,
  artworkCount,
  searchResultsCount = 0,
  isSearching = false,
  onEmbeddingTypeChange,
  onProjectionTypeChange,
  onColorByChange,
  onDisplayModeChange,
  onSearchChange
}: VisualizationControlsProps) {
  return (
    <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3">
      <div className="flex flex-wrap gap-2 sm:gap-4 items-end">
        {/* Search input - takes more space */}
        <div className="flex-1 min-w-[210px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              type="search"
              placeholder="Search artworks..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 pr-10"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin" />
            )}
          </div>
        </div>

        {/* Embedding Type */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Layers className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select value={embeddingType} onValueChange={onEmbeddingTypeChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jina_v3">Text (Jina v3)</SelectItem>
              <SelectItem value="siglip2">
                Image (SigLIP2)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Projection Type */}
        <div className="flex items-center gap-1 sm:gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select value={projectionType} onValueChange={onProjectionTypeChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard_2d">Standard 2D</SelectItem>
              <SelectItem value="tight_2d">Tight 2D</SelectItem>
              <SelectItem value="loose_2d">Loose 2D</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Color By */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Palette className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select value={colorBy} onValueChange={onColorByChange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="artist">Artist</SelectItem>
              <SelectItem value="period">Period</SelectItem>
              <SelectItem value="tags">Tags</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Display Mode */}
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="h-4 w-4 text-muted-foreground hidden sm:block">
            {displayMode === 'points' ? <Circle className="h-4 w-4" /> : <Image className="h-4 w-4" />}
          </div>
          <Select value={displayMode} onValueChange={onDisplayModeChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="points">
                <div className="flex items-center gap-2">
                  <Circle className="h-3 w-3" />
                  <span>Points</span>
                </div>
              </SelectItem>
              <SelectItem value="thumbnails">
                <div className="flex items-center gap-2">
                  <Image className="h-3 w-3" />
                  <span>Thumbnails</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Artwork count */}
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {searchResultsCount > 0 && (
            <>
              <span className="font-medium">{searchResultsCount.toLocaleString()}</span>
              <span> of </span>
            </>
          )}
          <span>{artworkCount.toLocaleString()} artworks</span>
        </div>
      </div>
    </div>
  );
}