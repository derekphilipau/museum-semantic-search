import Image from 'next/image';
import { Artwork } from '@/app/types';

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
      <div 
        className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden cursor-pointer hover:bg-gray-100 hover:border-gray-300 transition-all relative group w-full max-w-[300px]"
        onClick={onCompareClick}
      >
        <div className="relative bg-white">
          <div className="relative h-48 w-full">
            <Image
              src={imageUrl}
              alt={metadata.title}
              fill
              className="object-contain p-2"
              sizes="280px"
            />
          </div>
          {onCompareClick && (
            <button
              className="absolute bottom-2 right-2 bg-blue-600 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-sm shadow-lg hover:bg-blue-700"
              title="Compare models"
            >
              🔍
            </button>
          )}
        </div>
        <div className="p-3 w-full max-w-full overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 break-words w-full">
            {metadata.title}
          </h3>
          <p className="text-xs text-gray-600 line-clamp-1 mt-1 break-words w-full">{metadata.artist}</p>
        </div>
      </div>
    );
  }

  // Full version
  return (
    <div className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-3">
      {rank && (
        <div className="text-xs text-gray-500 mb-1">#{rank}</div>
      )}
      
      <div className="relative aspect-[3/4] mb-3 bg-gray-100 rounded overflow-hidden">
        <Image
          src={imageUrl}
          alt={metadata.title}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw"
        />
      </div>

      <div className="space-y-1">
        <h3 className="font-medium text-sm line-clamp-2 break-words">
          {metadata.title}
        </h3>
        
        <p className="text-xs text-gray-600 line-clamp-1">
          {metadata.artist}
        </p>
        
        {metadata.dateCreated && (
          <p className="text-xs text-gray-500">{metadata.dateCreated}</p>
        )}
        
        {metadata.department && (
          <p className="text-xs text-gray-500 line-clamp-1">
            {metadata.department}
          </p>
        )}

        {showScore && score !== undefined && (
          <div className="text-xs text-gray-400 mt-2">
            Score: {score.toFixed(3)}
          </div>
        )}

        {onCompareClick && (
          <button
            onClick={onCompareClick}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            title="Compare models for this artwork"
          >
            🔍 Compare Models
          </button>
        )}
      </div>
    </div>
  );
}