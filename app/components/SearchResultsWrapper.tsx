'use client';

import { useState } from 'react';
import { SearchResponse, SearchMetadata, ESHybridQuery } from '@/app/types';
import AllModesResults from './AllModesResults';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface SearchResultsWrapperProps {
  query: string;
  results: {
    keyword: SearchResponse | null;
    semantic: Record<string, SearchResponse>;
    hybrid: { model: string; results: SearchResponse } | null;
    metadata?: SearchMetadata;
  };
}

export default function SearchResultsWrapper({ query, results }: SearchResultsWrapperProps) {
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  

  return (
    <div className="space-y-2">
      {results.metadata && (
        <div className="text-xs text-gray-500 flex flex-wrap gap-4">
          {results.metadata.indexName && (
            <span>Index: {results.metadata.indexName}</span>
          )}
          {results.metadata.indexSizeHuman && (
            <span>Size: {results.metadata.indexSizeHuman}</span>
          )}
          {results.metadata.totalDocuments && (
            <span>Documents: {results.metadata.totalDocuments.toLocaleString()}</span>
          )}
          {results.metadata.totalQueryTime && (
            <span>Total time: {results.metadata.totalQueryTime}ms</span>
          )}
          {results.metadata.esQueries && (
            <>
              {results.metadata.esQueries.keyword && (
                <span>ES Keyword: ✓</span>
              )}
              {Object.keys(results.metadata.esQueries.semantic || {}).length > 0 && (
                <span>ES Semantic: {Object.keys(results.metadata.esQueries.semantic || {}).length} model(s)</span>
              )}
              {results.metadata.esQueries.hybrid && (
                <span>ES Hybrid: {typeof results.metadata.esQueries.hybrid === 'object' && 'model' in results.metadata.esQueries.hybrid ? (results.metadata.esQueries.hybrid as ESHybridQuery).model : 'RRF'}</span>
              )}
              <Dialog open={queryDialogOpen} onOpenChange={setQueryDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-5 px-2 text-xs">
                    View ES Queries
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
                  <DialogHeader>
                    <DialogTitle>Elasticsearch Query Details</DialogTitle>
                    <DialogDescription>
                      The actual Elasticsearch queries sent to the server
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {results.metadata.esQueries.keyword && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2">Keyword Search Query</h3>
                        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-xs">
                          <code>{JSON.stringify(results.metadata.esQueries.keyword, null, 2)}</code>
                        </pre>
                      </div>
                    )}
                    {Object.keys(results.metadata.esQueries.semantic || {}).length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2">Semantic Search Queries</h3>
                        {Object.entries(results.metadata.esQueries.semantic || {}).map(([model, query]) => (
                          <div key={model} className="mb-3">
                            <h4 className="text-xs font-medium mb-1 text-gray-600">{model}</h4>
                            <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-xs">
                              <code>{JSON.stringify(query, null, 2)}</code>
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                    {results.metadata.esQueries.hybrid && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2">Hybrid Search Configuration</h3>
                        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-xs">
                          <code>{JSON.stringify(results.metadata.esQueries.hybrid, null, 2)}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      )}
      <AllModesResults
        query={query}
        results={results}
        loading={false}
      />
    </div>
  );
}