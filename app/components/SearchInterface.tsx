'use client';

import { useState } from 'react';
import { searchArtworks } from '@/app/lib/search';
import { EMBEDDING_MODELS, ModelKey } from '@/lib/embeddings/types';
import { SearchMode, SearchResponse } from '@/app/types';
import ArtworkCard from './ArtworkCard';

export default function SearchInterface() {
  const [query, setQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelKey>('jina_clip_v2');
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setLoading(true);
    setError(null);

    try {
      const response = await searchArtworks({
        query,
        model: selectedModel,
        mode: searchMode,
        size: 20,
      });
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <form onSubmit={handleSearch} className="mb-8">
        <div className="space-y-4">
          <div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artworks..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Search Mode</label>
              <div className="flex gap-2">
                {(['keyword', 'semantic', 'hybrid'] as SearchMode[]).map((mode) => (
                  <label key={mode} className="flex items-center">
                    <input
                      type="radio"
                      value={mode}
                      checked={searchMode === mode}
                      onChange={(e) => setSearchMode(e.target.value as SearchMode)}
                      className="mr-1"
                    />
                    <span className="text-sm capitalize">{mode}</span>
                  </label>
                ))}
              </div>
            </div>

            {searchMode !== 'keyword' && (
              <div>
                <label className="block text-sm font-medium mb-2">Embedding Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as ModelKey)}
                  className="px-3 py-1 border border-gray-300 rounded"
                >
                  {Object.entries(EMBEDDING_MODELS).map(([key, model]) => (
                    <option key={key} value={key}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {results && (
        <div>
          <div className="mb-4 text-sm text-gray-600">
            Found {results.total} results in {results.took}ms
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {results.hits.map((hit, index) => (
              <ArtworkCard
                key={hit._id}
                artwork={hit._source}
                score={hit._score}
                showScore={searchMode !== 'keyword'}
                rank={index + 1}
              />
            ))}
          </div>

          {results.hits.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              No artworks found matching your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}