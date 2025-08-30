'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';
import AllModesResults from './AllModesResults';
import { searchArtworks } from '@/app/lib/search';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export default function MultiModelSearch() {
  const [query, setQuery] = useState('baby');
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
      // Build search promises based on selected options
      const searchPromises = [];
      
      // Keyword search
      if (searchOptions.keyword) {
        searchPromises.push(
          searchArtworks({ query, mode: 'keyword', size: 10 })
        );
      }
      
      // Semantic searches for selected models
      const selectedModels = Object.keys(EMBEDDING_MODELS).filter(
        modelKey => searchOptions.models[modelKey]
      );
      
      searchPromises.push(
        ...selectedModels.map(modelKey =>
          searchArtworks({ 
            query, 
            model: modelKey as ModelKey, 
            mode: 'semantic', 
            size: 10 
          }).then(result => ({ model: modelKey, result }))
        )
      );
      
      // Hybrid search with the first selected model
      if (searchOptions.hybrid && selectedModels.length > 0) {
        searchPromises.push(
          searchArtworks({ 
            query, 
            model: selectedModels[0] as ModelKey, 
            mode: 'hybrid', 
            size: 10 
          })
        );
      }

      const searchResults = await Promise.allSettled(searchPromises);
      
      const newResults: typeof results = {
        keyword: null,
        semantic: {},
        hybrid: null,
      };

      let keywordIndex = searchOptions.keyword ? 0 : -1;
      let hybridIndex = searchOptions.hybrid && selectedModels.length > 0 ? searchResults.length - 1 : -1;
      
      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (index === keywordIndex) {
            // Keyword result
            newResults.keyword = result.value as SearchResponse;
          } else if (index === hybridIndex) {
            // Hybrid result
            newResults.hybrid = {
              model: selectedModels[0],
              results: result.value as SearchResponse
            };
          } else {
            // Semantic results
            const resultValue = result.value as { model: string; result: SearchResponse } | SearchResponse;
            if ('model' in resultValue) {
              newResults.semantic[resultValue.model] = resultValue.result;
            }
          }
        } else {
          console.error('Search failed:', result.reason);
        }
      });

      setResults(newResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectArtwork = (artwork: any) => {
    // Navigation is now handled by Link components in ArtworkCard
  };

  // Run initial search on component mount
  useEffect(() => {
    if (query) {
      // Create a form submit event
      const form = document.createElement('form');
      const event = new Event('submit', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'preventDefault', { value: () => {} });
      handleSearch(event as any);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-3">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artworks (try 'woman', 'landscape', 'portrait')"
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
      </Card>

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