import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6">
      {/* Artwork info card skeleton */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Image skeleton */}
            <div className="md:col-span-1">
              <Skeleton className="h-72 w-full rounded-lg" />
            </div>
            
            {/* Metadata skeleton */}
            <div className="md:col-span-2 space-y-3">
              <Skeleton className="h-8 w-3/4" />
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
              
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-48" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Similar artworks section skeleton */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-40" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="bg-gradient-to-r from-gray-200 to-gray-300 rounded-t-lg p-4">
                <Skeleton className="h-5 w-32 mx-auto mb-2" />
                <Skeleton className="h-3 w-48 mx-auto" />
              </div>
              <div className="p-3 space-y-2">
                {[...Array(3)].map((_, j) => (
                  <Skeleton key={j} className="h-16 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}