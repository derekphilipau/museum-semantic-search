import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export default function ExploreLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] relative overflow-hidden">
      {/* Loading state for controls bar */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex flex-wrap gap-2 sm:gap-4 items-end">
            {/* Search input skeleton */}
            <div className="flex-1 min-w-[200px]">
              <Skeleton className="h-10 w-full" />
            </div>
            
            {/* Control skeletons */}
            <Skeleton className="h-10 w-[110px] sm:w-[140px]" />
            <Skeleton className="h-10 w-[100px] sm:w-[120px]" />
            <Skeleton className="h-10 w-[80px] sm:w-[100px]" />
            
            {/* Count skeleton */}
            <Skeleton className="h-6 w-[120px]" />
          </div>
        </div>
      </div>
      
      {/* Loading state for visualization area */}
      <div className="flex-1 p-4 overflow-hidden">
        <Card className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <div className="animate-pulse">
              <div className="w-16 h-16 mx-auto rounded-full bg-muted" />
            </div>
            <p className="text-sm text-muted-foreground">Loading visualization...</p>
          </div>
        </Card>
      </div>
    </div>
  );
}