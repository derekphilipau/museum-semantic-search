import Image from 'next/image';
import { Artwork } from '@/app/types';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

interface ArtworkCardProps {
  artwork: Artwork;
  score?: number;
  showScore?: boolean;
  rank?: number;
  compact?: boolean;
  onCompareClick?: () => void;
}

export default function ArtworkCard({
  artwork,
  score,
  showScore = false,
  rank,
  compact = false,
  onCompareClick,
}: ArtworkCardProps) {
  const { metadata, image } = artwork;
  // Handle both full image objects and simple string URLs
  const imageUrlString = typeof image === 'string' ? image : image.url;
  const imageUrl = imageUrlString.startsWith('/images/') 
    ? imageUrlString 
    : `/images/${imageUrlString}`;

  // Compact version for multi-column layout
  if (compact) {
    return (
      <Card 
        className="overflow-hidden cursor-pointer hover:shadow-lg transition-all w-full h-full flex flex-col"
        onClick={onCompareClick}
      >
        <CardContent className="p-3 flex flex-col h-full">
          {/* Image - fixed height container */}
          <div className="h-48 rounded-md bg-muted/50 mb-2 relative overflow-hidden flex items-center justify-center">
            <Image
              src={imageUrl}
              alt={metadata.title}
              fill
              className="object-contain p-2"
              sizes="(max-width: 768px) 100vw, 280px"
            />
          </div>
          
          {/* Content section - flex-grow to push score to bottom */}
          <div className="flex-grow flex flex-col">
            {/* Title */}
            <CardTitle className="text-sm mb-1 line-clamp-2 break-words">
              {metadata.title}
            </CardTitle>
            
            {/* Artist */}
            <CardDescription className="text-xs mb-2 line-clamp-1">
              {metadata.artist || 'Unknown artist'}
            </CardDescription>
            
            {/* Department and Date - optional, takes available space */}
            {(metadata.department || metadata.dateCreated) && (
              <div className="text-xs text-muted-foreground space-y-0.5 flex-grow">
                {metadata.department && (
                  <div className="line-clamp-1">{metadata.department}</div>
                )}
                {metadata.dateCreated && (
                  <div>{metadata.dateCreated}</div>
                )}
              </div>
            )}
          </div>
          
          {/* Score - always at bottom */}
          {showScore && score !== undefined && (
            <div className="flex items-center justify-between pt-2 mt-auto border-t">
              <span className="text-xs text-muted-foreground">Score</span>
              <span className="text-xs font-mono font-semibold">{score.toFixed(3)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full version
  return (
    <Card 
      className="overflow-hidden cursor-pointer hover:shadow-lg transition-all h-full flex flex-col"
      onClick={onCompareClick}
    >
      <CardContent className="p-4 flex flex-col h-full">
        {rank && (
          <div className="text-xs text-muted-foreground mb-2">Rank #{rank}</div>
        )}
        
        {/* Image - fixed height container */}
        <div className="h-64 rounded-md bg-muted/50 mb-3 relative overflow-hidden flex items-center justify-center">
          <Image
            src={imageUrl}
            alt={metadata.title}
            fill
            className="object-contain p-3"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw"
          />
        </div>
        
        {/* Content section - flex-grow to fill available space */}
        <div className="flex-grow flex flex-col">
          {/* Title */}
          <CardTitle className="text-base mb-1 line-clamp-2 break-words">
            {metadata.title}
          </CardTitle>
          
          {/* Artist */}
          <CardDescription className="text-sm mb-2 line-clamp-1">
            {metadata.artist || 'Unknown artist'}
          </CardDescription>
          
          {/* Metadata - takes available space */}
          <div className="text-xs text-muted-foreground space-y-1 flex-grow">
            {metadata.dateCreated && (
              <div>{metadata.dateCreated}</div>
            )}
            {metadata.department && (
              <div className="line-clamp-1">{metadata.department}</div>
            )}
            {metadata.medium && (
              <div className="line-clamp-1">{metadata.medium}</div>
            )}
          </div>
        </div>
        
        {/* Score - always at bottom */}
        {showScore && score !== undefined && (
          <div className="flex items-center justify-between pt-3 mt-auto border-t">
            <span className="text-sm text-muted-foreground">Relevance Score</span>
            <span className="text-sm font-mono font-semibold">{score.toFixed(3)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}