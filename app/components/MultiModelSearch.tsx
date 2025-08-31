'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { SearchResponse, Artwork } from '@/app/types';
import AllModesResults from './AllModesResults';
import { searchArtworks } from '@/app/lib/search-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export default function MultiModelSearch() {
  const [query, setQuery] = useState('abstract');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    keyword: SearchResponse | null;
    semantic: Record<string, SearchResponse>;
    hybrid: { model: string; results: SearchResponse } | null;
  }>({
    keyword: null,
    semantic: {},
    hybrid: null,
  });

  // Search options state
  const [searchOptions, setSearchOptions] = useState<{
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
  }>({
    keyword: true,
    models: Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
    hybrid: true,
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Make a single request to the unified search API
      const searchResults = await searchArtworks(query, searchOptions, 10);
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectArtwork = (artwork: Artwork) => {
    // Navigation is now handled by Link components in ArtworkCard
  };

  // Run initial search on component mount
  useEffect(() => {
    if (query) {
      const searchOnMount = async () => {
        setLoading(true);
        setError(null);
        
        try {
          // Make a single request to the unified search API
          const searchResults = await searchArtworks(query, searchOptions, 10);
          setResults(searchResults);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Search failed');
        } finally {
          setLoading(false);
        }
      };
      
      searchOnMount();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-3">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artworks (try 'abstract', 'picasso', 'print', 'collage')"
            className="flex-1"
            disabled={loading}
          />
          <Button 
            type="submit" 
            disabled={loading || !query.trim()}
            size="default"
          >
            <Search className="w-4 h-4 mr-2" />
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
        
        {/* Search options */}
        <div className="flex flex-wrap gap-4">
          {/* Keyword search checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="keyword"
              checked={searchOptions.keyword}
              onCheckedChange={(checked) => 
                setSearchOptions(prev => ({ ...prev, keyword: checked as boolean }))
              }
            />
            <Label htmlFor="keyword" className="text-sm cursor-pointer">
              Keyword Search
            </Label>
          </div>
          
          {/* Model checkboxes */}
          {Object.entries(EMBEDDING_MODELS).map(([key, model]) => (
            <div key={key} className="flex items-center space-x-2">
              <Checkbox
                id={key}
                checked={searchOptions.models[key]}
                onCheckedChange={(checked) => 
                  setSearchOptions(prev => ({
                    ...prev,
                    models: { ...prev.models, [key]: checked as boolean }
                  }))
                }
              />
              <Label htmlFor={key} className="text-sm cursor-pointer">
                {model.name}
              </Label>
            </div>
          ))}
          
          {/* Hybrid search checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="hybrid"
              checked={searchOptions.hybrid}
              onCheckedChange={(checked) => 
                setSearchOptions(prev => ({ ...prev, hybrid: checked as boolean }))
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
      </form>

      {error && (
        <Card className="p-4 border-destructive">
          <div className="text-destructive text-sm">
            {error}
          </div>
        </Card>
      )}

      <AllModesResults
        query={query}
        results={results}
        loading={loading}
        onSelectArtwork={handleSelectArtwork}
      />
    </div>
  );
}