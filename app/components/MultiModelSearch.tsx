'use client';

import { useState } from 'react';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { SearchResponse } from '@/app/types';
import AllModesResults from './AllModesResults';
import { searchArtworks } from '@/app/lib/search';

export default function MultiModelSearch() {
  const [query, setQuery] = useState('');
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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Run all searches in parallel
      const searchPromises = [
        // Keyword search
        searchArtworks({ query, mode: 'keyword', size: 10 }),
        
        // Semantic searches for all models
        ...Object.keys(EMBEDDING_MODELS).map(modelKey =>
          searchArtworks({ 
            query, 
            model: modelKey as ModelKey, 
            mode: 'semantic', 
            size: 10 
          }).then(result => ({ model: modelKey, result }))
        ),
        
        // Hybrid search with the most recent model
        searchArtworks({ 
          query, 
          model: 'jina_clip_v2', 
          mode: 'hybrid', 
          size: 10 
        }),
      ];

      const searchResults = await Promise.allSettled(searchPromises);
      
      const newResults: typeof results = {
        keyword: null,
        semantic: {},
        hybrid: null,
      };

      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (index === 0) {
            // Keyword result
            newResults.keyword = result.value as SearchResponse;
          } else if (index === searchResults.length - 1) {
            // Hybrid result
            newResults.hybrid = {
              model: 'jina_clip_v2',
              results: result.value as SearchResponse
            };
          } else {
            // Semantic results
            const { model, result: searchResult } = result.value as { model: string; result: SearchResponse };
            newResults.semantic[model] = searchResult;
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
    console.log('Selected artwork for comparison:', artwork);
    // TODO: Implement model comparison view
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSearch} className="max-w-3xl mx-auto mb-8 px-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artworks (try 'woman', 'landscape', 'portrait')"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {loading ? 'Searching...' : 'Search All Models'}
          </button>
        </div>
        <p className="text-sm text-gray-600 mt-2 text-center">
          Compare results across keyword search, visual similarity, and hybrid approaches
        </p>
      </form>

      {error && (
        <div className="max-w-7xl mx-auto px-6 mb-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        </div>
      )}

      <div className="max-w-full px-6">
        <AllModesResults
          query={query}
          results={results}
          loading={loading}
          onSelectArtwork={handleSelectArtwork}
        />
      </div>
    </div>
  );
}