import { Skeleton } from '@/components/ui/skeleton';
import SearchForm from './components/SearchForm';

export default function Loading() {
  // Show the search form immediately with empty initial values
  // This prevents layout shift and keeps the form interactive
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-6">
        <SearchForm 
          initialQuery=""
          initialOptions={{ 
            keyword: true, 
            models: Object.keys(EMBEDDING_MODELS).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
            hybrid: true 
          }}
        />
        
        {/* Loading skeleton for search results */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Skeleton for each search mode column */}
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-32 w-full rounded-lg" />
                <div className="space-y-2">
                  {[...Array(3)].map((_, j) => (
                    <div key={j} className="space-y-2">
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Import at build time to avoid circular dependency
import { EMBEDDING_MODELS } from '@/lib/embeddings/types';