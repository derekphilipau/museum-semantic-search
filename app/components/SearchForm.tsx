'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Info, Image as ImageIcon } from 'lucide-react';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import ImageSearchUpload from './ImageSearchUpload';
import SearchResultsWrapper from './SearchResultsWrapper';
import EmojiPalette from './EmojiPalette';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type HybridMode = 'text' | 'image' | 'both';

interface SearchFormProps {
  initialQuery: string;
  initialOptions: {
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
    hybridMode?: HybridMode;
    hybridBalance?: number;
    includeDescriptions?: boolean;
    emoji?: boolean;
  };
}

// Helper to build URL search params
function buildSearchParams(
  query: string,
  options: { keyword: boolean; models: Record<string, boolean>; hybrid: boolean; hybridMode?: HybridMode; hybridBalance?: number; includeDescriptions?: boolean; emoji?: boolean }
): string {
  const params = new URLSearchParams();
  
  if (query) {
    params.set('q', query);
  }
  
  params.set('keyword', options.keyword.toString());
  params.set('hybrid', options.hybrid.toString());
  
  // Add hybrid mode if hybrid is enabled
  if (options.hybrid && options.hybridMode) {
    params.set('hybridMode', options.hybridMode);
  }
  
  // Add hybrid balance if hybrid is enabled and balance is specified
  if (options.hybrid && options.hybridBalance !== undefined) {
    params.set('hybridBalance', options.hybridBalance.toString());
  }
  
  // Add includeDescriptions parameter - only set to false if explicitly disabled
  if (options.includeDescriptions === false) {
    params.set('includeDescriptions', 'false');
  }
  
  // Always include models parameter
  const enabledModels = Object.entries(options.models)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  
  // Always set models param, even if all are selected
  params.set('models', enabledModels.join(','));
  
  // Add emoji parameter if it's true (for emoji searches)
  if (options.emoji) {
    params.set('emoji', 'true');
  }
  
  return params.toString();
}

interface ImageSearchState {
  isSearching: boolean;
  results: SearchResponse | null;
  error: string | null;
}

export default function SearchForm({ initialQuery, initialOptions }: SearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<'text' | 'image'>('text');
  const [selectedImage, setSelectedImage] = useState<{ file: File | null; preview: string | null }>({ file: null, preview: null });
  const [imageSearchState, setImageSearchState] = useState<ImageSearchState>({
    isSearching: false,
    results: null,
    error: null
  });
  const [searchOptions, setSearchOptions] = useState({
    ...initialOptions,
    hybridMode: initialOptions.hybridMode || 'image',
    hybridBalance: initialOptions.hybridBalance ?? 0.5
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (searchMode === 'text') {
      if (!query.trim()) return;
      
      // Check if query contains only emojis
      const queryEmojis = query.match(/\p{Emoji}/gu) || [];
      const queryWithoutEmojis = query.replace(/\p{Emoji}/gu, '').trim();
      const isOnlyEmojis = queryEmojis.length > 0 && queryWithoutEmojis === '';
      
      // Build params with emoji flag if query contains only emojis
      const params = buildSearchParams(query, {
        ...searchOptions,
        emoji: isOnlyEmojis || searchOptions.emoji
      });
      router.push(`/?${params}`);
    } else {
      // Image search
      if (!selectedImage.preview) {
        setImageSearchState({ ...imageSearchState, error: 'Please select an image to search' });
        return;
      }
      
      setImageSearchState({ isSearching: true, results: null, error: null });
      
      try {
        // Call the image search API endpoint
        const response = await fetch('/api/image-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: selectedImage.preview })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Image search failed');
        }
        
        const results = await response.json();
        setImageSearchState({ isSearching: false, results, error: null });
        
        // Scroll to results if they exist
        if (results.semantic?.siglip2?.hits?.length > 0) {
          setTimeout(() => {
            document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }
      } catch (error) {
        console.error('Image search error:', error);
        setImageSearchState({ 
          isSearching: false, 
          results: null, 
          error: error instanceof Error ? error.message : 'Failed to process image'
        });
      }
    }
  };
  
  const handleImageSelect = (file: File | null, preview: string | null) => {
    setSelectedImage({ file, preview });
  };

  const handleOptionsChange = (updates: Partial<typeof searchOptions>) => {
    const newOptions = { ...searchOptions, ...updates };
    
    // If hybrid is enabled but no models are selected, disable hybrid
    if (newOptions.hybrid && !Object.values(newOptions.models).some(v => v)) {
      newOptions.hybrid = false;
    }
    
    setSearchOptions(newOptions);
  };

  return (
    <>
    <form onSubmit={handleSearch} className="space-y-4">
      <Tabs value={searchMode} onValueChange={(value) => setSearchMode(value as 'text' | 'image')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="text">Text Search</TabsTrigger>
          <TabsTrigger value="image">Image Search</TabsTrigger>
        </TabsList>
        
        <TabsContent value="text" className="space-y-3">
          <div className="flex gap-3">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artworks (try 'abstract', 'picasso', 'print', 'collage')"
              className="flex-1 text-lg md:text-xl h-10"
            />
            <Button 
              type="submit" 
              disabled={!query.trim()}
              size="default"
              className="text-lg md:text-xl h-10"
            >
              <Search className="size-5" />
              Search
            </Button>
          </div>
        </TabsContent>
        
        <TabsContent value="image" className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <ImageSearchUpload onImageSelect={handleImageSelect} />
            </div>
            <Button 
              type="submit" 
              disabled={!selectedImage.file || imageSearchState.isSearching}
              size="default"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              {imageSearchState.isSearching ? 'Processing...' : 'Search'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload an image to find visually similar artworks using AI
          </p>
          {imageSearchState.error && (
            <p className="text-xs text-red-500 mt-2">{imageSearchState.error}</p>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Search options - only show for text search */}
      {searchMode === 'text' && (
      <div className="space-y-4">
        {/* First row: All search type switches including hybrid */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium">Search types:</span>
          
          {/* Keyword search switch */}
          <div className="flex items-center space-x-2">
            <Switch
              id="keyword"
              checked={searchOptions.keyword}
              onCheckedChange={(checked) => 
                handleOptionsChange({ keyword: checked })
              }
            />
            <Label htmlFor="keyword" className="text-sm cursor-pointer">
              Keyword
            </Label>
          </div>
          
          {/* Model switches */}
          {Object.entries(EMBEDDING_MODELS).map(([key, model]) => (
            <div key={key} className="flex items-center space-x-2">
              <Switch
                id={key}
                checked={searchOptions.models[key]}
                onCheckedChange={(checked) => 
                  handleOptionsChange({
                    models: { ...searchOptions.models, [key]: checked }
                  })
                }
              />
              <Label htmlFor={key} className="text-sm cursor-pointer">
                {model.name}
              </Label>
            </div>
          ))}
          
          {/* Hybrid search switch */}
          <div className="flex items-center space-x-2">
            <Switch
              id="hybrid"
              checked={searchOptions.hybrid}
              onCheckedChange={(checked) => 
                handleOptionsChange({ hybrid: checked })
              }
              disabled={!Object.values(searchOptions.models).some(v => v)}
            />
            <Label 
              htmlFor="hybrid" 
              className={`text-sm cursor-pointer ${
                !Object.values(searchOptions.models).some(v => v) ? 'text-muted-foreground' : ''
              }`}
            >
              Hybrid Search
            </Label>
          </div>
        </div>
        
        {/* Second row: Visual descriptions and hybrid mode options */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Include visual descriptions checkbox */}
          <span className="text-sm font-medium">Keyword Options:</span>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeDescriptions"
              checked={searchOptions.includeDescriptions !== false}
              onCheckedChange={(checked) => 
                handleOptionsChange({ includeDescriptions: checked as boolean })
              }
            />
            <Label htmlFor="includeDescriptions" className="text-sm cursor-pointer">
              Include AI Visual Descriptions
              <span className="italic text-muted-foreground">
                Due to costs, only ~3500 artworks have AI-generated descriptions
              </span>
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Hybrid mode selector - only show when hybrid is enabled */}
          {searchOptions.hybrid && Object.values(searchOptions.models).some(v => v) && (
            <>
              <span className="text-sm font-medium">Hybrid Search Options:</span>
              <TooltipProvider>
                <div className="flex items-center gap-2">
                  <RadioGroup 
                    value={searchOptions.hybridMode || 'image'} 
                    onValueChange={(value) => handleOptionsChange({ hybridMode: value as HybridMode })}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="text" id="hybrid-text" />
                      <Label htmlFor="hybrid-text" className="text-sm cursor-pointer">
                        Text Embeddings
                      </Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="image" id="hybrid-image" />
                      <Label htmlFor="hybrid-image" className="text-sm cursor-pointer">
                        Image Embeddings
                      </Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="both" id="hybrid-both" />
                      <Label htmlFor="hybrid-both" className="text-sm cursor-pointer">
                        Text & Image Embeddings
                      </Label>
                    </div>
                  </RadioGroup>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs text-sm">
                        Choose which embeddings to combine with keyword search using Elasticsearch&apos;s RRF:
                        <br />• Text: Keyword + Jina v3 text embeddings
                        <br />• Image: Keyword + SigLIP 2 cross-modal embeddings (default)
                        <br />• Both: Keyword + both Jina v3 and SigLIP 2
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
              
              {/* Balance slider */}
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">
                  Keyword
                </Label>
                <Slider
                  value={[searchOptions.hybridBalance ?? 0.5]}
                  onValueChange={([value]) => handleOptionsChange({ hybridBalance: value })}
                  max={1}
                  min={0}
                  step={0.1}
                  className="w-32"
                />
                <Label className="text-xs whitespace-nowrap">
                  Semantic
                </Label>
                <span className="text-xs min-w-[3ch] text-right">
                  {Math.round((searchOptions.hybridBalance ?? 0.5) * 100)}%
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      )}
      
      {/* Emoji Palette */}
      <EmojiPalette />
    </form>
    
    {/* Image search results display */}
    {searchMode === 'image' && imageSearchState.results && (
      <div id="search-results" className="mt-6">
        <SearchResultsWrapper
          query="Image Search"
          results={{
            keyword: null,
            semantic: { siglip2: imageSearchState.results },
            hybrid: null
          }}
        />
      </div>
    )}
    </>
  );
}