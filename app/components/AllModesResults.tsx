'use client';

import React from 'react';
import { Search, Brain, Zap, ExternalLink } from 'lucide-react';
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';
import ArtworkCard from './ArtworkCard';
import { Artwork, SearchResponse } from '@/app/types';

interface AllModesResultsProps {
  query: string;
  results: {
    keyword: SearchResponse | null;
    semantic: Record<string, SearchResponse>;
    hybrid: { model: string; results: SearchResponse } | null;
  };
  loading: boolean;
  onSelectArtwork: (artwork: Artwork) => void;
}

// Model metadata with URLs and descriptions
const MODEL_INFO = {
  jina_clip_v2: {
    url: 'https://huggingface.co/jinaai/jina-clip-v2',
    description: '🎨 Best for Art (2024)',
    year: '2024'
  },
  voyage_multimodal_3: {
    url: 'https://www.voyageai.com/',
    description: '🚀 Interleaved (2025)',
    year: '2025'
  },
  google_vertex_multimodal: {
    url: 'https://cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-multimodal-embeddings',
    description: '🆓 Free Tier (2024)',
    year: '2024'
  },
  cohere_embed_4: {
    url: 'https://cohere.com/embed',
    description: '📄 For Documents (2025)',
    year: '2025'
  }
} as const;

export default function AllModesResults({ 
  query,
  results, 
  loading,
  onSelectArtwork 
}: AllModesResultsProps) {
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!query) {
    return (
      <div className="text-center text-gray-500 py-8">
        Enter a search query to explore artworks
      </div>
    );
  }

  // Check if we have any results
  const hasResults = 
    (results.keyword && results.keyword.hits.length > 0) ||
    Object.values(results.semantic).some(r => r && r.hits.length > 0) ||
    (results.hybrid?.results && results.hybrid.results.hits.length > 0);

  if (!hasResults) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p>No results found for "{query}"</p>
        <p className="text-sm mt-2">Try different search terms</p>
      </div>
    );
  }

  // Get ordered models
  const orderedModels = Object.keys(EMBEDDING_MODELS).sort((a, b) => {
    const yearA = parseInt(EMBEDDING_MODELS[a as keyof typeof EMBEDDING_MODELS].year);
    const yearB = parseInt(EMBEDDING_MODELS[b as keyof typeof EMBEDDING_MODELS].year);
    return yearB - yearA; // Most recent first
  });

  return (
    <div className="space-y-8">
      {/* Scrollable container for dynamic columns */}
      <div className="overflow-x-auto pb-4">
        {/* Single row with all search types */}
        <div className="flex gap-6" style={{ minWidth: `${(orderedModels.length + 2) * 340}px` }}>
          {/* Keyword Search - Single Column */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden min-w-[320px] flex-shrink-0">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-3">
              <div className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                <div>
                  <h3 className="font-bold">Keyword</h3>
                  <p className="text-xs opacity-90">Native ES</p>
                </div>
              </div>
            </div>
            
            <div className="p-3">
              {!results.keyword || results.keyword.hits.length === 0 ? (
                <div className="text-gray-400 text-sm">No results</div>
              ) : (
                <div className="space-y-2">
                  {results.keyword.hits.slice(0, 5).map((hit, index) => (
                    <div key={`keyword-${hit._id}-${index}`} className="relative">
                      <div className="absolute -left-3 top-3 bg-gray-800 text-white text-xs px-2 py-1 rounded-r font-bold z-10">
                        #{index + 1}
                      </div>
                      <ArtworkCard 
                        artwork={hit._source} 
                        onCompareClick={() => onSelectArtwork(hit._source)}
                        compact
                        showScore={false}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Visual Similarity - One column per model */}
          {orderedModels.map((modelKey) => {
            const model = EMBEDDING_MODELS[modelKey as keyof typeof EMBEDDING_MODELS];
            const semanticResults = results.semantic[modelKey];
            
            return (
              <div key={`semantic-${modelKey}`} className="bg-white rounded-lg shadow-md overflow-hidden min-w-[320px] flex-shrink-0">
                <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <a 
                          href={MODEL_INFO[modelKey as keyof typeof MODEL_INFO]?.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="font-bold text-sm hover:underline flex items-center gap-1"
                        >
                          {model.name}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <p className="text-xs opacity-90">
                        {MODEL_INFO[modelKey as keyof typeof MODEL_INFO]?.description || model.notes}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="p-3">
                  {!semanticResults || semanticResults.hits.length === 0 ? (
                    <div className="text-gray-400 text-sm">No results</div>
                  ) : (
                    <div className="space-y-2">
                      {semanticResults.hits.slice(0, 5).map((hit, index) => (
                        <div key={`semantic-${modelKey}-${hit._id}-${index}`} className="relative">
                          <div className="absolute -left-3 top-3 bg-purple-700 text-white text-xs px-2 py-1 rounded-r font-bold z-10">
                            #{index + 1}
                          </div>
                          <ArtworkCard 
                            artwork={hit._source} 
                            onCompareClick={() => onSelectArtwork(hit._source)}
                            compact
                            showScore={false}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Hybrid Search - Single Column */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden min-w-[320px] flex-shrink-0">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                <div>
                  <h3 className="font-bold">Hybrid</h3>
                  <p className="text-xs opacity-90">
                    {results.hybrid ? EMBEDDING_MODELS[results.hybrid.model as keyof typeof EMBEDDING_MODELS]?.name : 'Not selected'}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="p-3">
              {!results.hybrid?.results || results.hybrid.results.hits.length === 0 ? (
                <div className="text-gray-400 text-sm">No results</div>
              ) : (
                <div className="space-y-2">
                  {results.hybrid.results.hits.slice(0, 5).map((hit, index) => (
                    <div key={`hybrid-${hit._id}-${index}`} className="relative">
                      <div className="absolute -left-3 top-3 bg-green-700 text-white text-xs px-2 py-1 rounded-r font-bold z-10">
                        #{index + 1}
                      </div>
                      <ArtworkCard 
                        artwork={hit._source} 
                        onCompareClick={() => onSelectArtwork(hit._source)}
                        compact
                        showScore={false}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Summary */}
      {query && hasResults && (
        <div className="bg-gray-100 rounded-lg p-4">
          <h3 className="font-bold text-gray-700 mb-3 text-sm">Search Performance Summary</h3>
          <div className="flex gap-3 text-xs overflow-x-auto">
            {/* Keyword */}
            <div className="bg-white rounded p-2 flex-shrink-0 min-w-[140px]">
              <div className="flex items-center gap-1 mb-1">
                <Search className="w-3 h-3 text-blue-600" />
                <span className="font-medium">Keyword</span>
              </div>
              <div className="text-gray-600">
                {results.keyword && (
                  <>
                    <div>Results: {results.keyword.hits.length}</div>
                    {results.keyword.hits[0]?._score && (
                      <div>Top score: {results.keyword.hits[0]._score.toFixed(3)}</div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Visual Similarity per model */}
            {orderedModels.map((modelKey) => {
              const model = EMBEDDING_MODELS[modelKey as keyof typeof EMBEDDING_MODELS];
              const semanticResults = results.semantic[modelKey];
              if (!semanticResults) return null;
              
              return (
                <div key={`summary-${modelKey}`} className="bg-white rounded p-2 flex-shrink-0 min-w-[120px]">
                  <div className="flex items-center gap-1 mb-1">
                    <Brain className="w-3 h-3 text-purple-600" />
                    <a 
                      href={MODEL_INFO[modelKey as keyof typeof MODEL_INFO]?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline text-xs flex items-center gap-1"
                    >
                      {model.name}
                      <ExternalLink className="w-2 h-2" />
                    </a>
                  </div>
                  <div className="text-gray-600">
                    <div>Results: {semanticResults.hits.length}</div>
                    {semanticResults.hits[0]?._score && (
                      <div>Top score: {semanticResults.hits[0]._score.toFixed(3)}</div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Hybrid */}
            {results.hybrid && (
              <div className="bg-white rounded p-2 flex-shrink-0 min-w-[140px]">
                <div className="flex items-center gap-1 mb-1">
                  <Zap className="w-3 h-3 text-green-600" />
                  <span className="font-medium">Hybrid</span>
                </div>
                <div className="text-gray-600">
                  <div>Results: {results.hybrid.results.hits.length}</div>
                  {results.hybrid.results.hits[0]?._score && (
                    <div>Top score: {results.hybrid.results.hits[0]._score.toFixed(3)}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}