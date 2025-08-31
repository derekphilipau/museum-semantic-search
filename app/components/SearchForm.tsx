'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface SearchFormProps {
  initialQuery: string;
  initialOptions: {
    keyword: boolean;
    models: Record<string, boolean>;
    hybrid: boolean;
  };
}

// Helper to build URL search params
function buildSearchParams(
  query: string,
  options: { keyword: boolean; models: Record<string, boolean>; hybrid: boolean }
): string {
  const params = new URLSearchParams();
  
  if (query) {
    params.set('q', query);
  }
  
  params.set('keyword', options.keyword.toString());
  params.set('hybrid', options.hybrid.toString());
  
  // Always include models parameter
  const enabledModels = Object.entries(options.models)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key);
  
  // Always set models param, even if all are selected
  params.set('models', enabledModels.join(','));
  
  return params.toString();
}

export default function SearchForm({ initialQuery, initialOptions }: SearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [searchOptions, setSearchOptions] = useState(initialOptions);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const params = buildSearchParams(query, searchOptions);
    router.push(`/?${params}`);
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
    <form onSubmit={handleSearch} className="space-y-4">
      <div className="flex gap-3">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artworks (try 'abstract', 'picasso', 'print', 'collage')"
          className="flex-1"
        />
        <Button 
          type="submit" 
          disabled={!query.trim()}
          size="default"
        >
          <Search className="w-4 h-4 mr-2" />
          Search
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
              handleOptionsChange({ keyword: checked as boolean })
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
                handleOptionsChange({
                  models: { ...searchOptions.models, [key]: checked as boolean }
                })
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
              handleOptionsChange({ hybrid: checked as boolean })
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
  );
}