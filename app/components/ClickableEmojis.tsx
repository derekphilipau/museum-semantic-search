'use client';

import { useRouter } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ClickableEmojisProps {
  emojis: string;
  className?: string;
  size?: 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
}

export default function ClickableEmojis({ emojis, className = '', size = 'base' }: ClickableEmojisProps) {
  const router = useRouter();
  
  // Parse individual emojis
  const emojiArray = emojis.match(/\p{Emoji}/gu) || [];
  
  const handleEmojiClick = (emoji: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Navigate to search with emoji
    const searchParams = new URLSearchParams({
      q: emoji
    });
    router.push(`/?${searchParams.toString()}`);
  };
  
  const sizeClasses = {
    sm: 'text-base',
    base: 'text-lg',
    lg: 'text-xl',
    xl: 'text-2xl',
    '2xl': 'text-3xl',
    '3xl': 'text-4xl'
  };
  
  return (
    <TooltipProvider delayDuration={200}>
      <span className={`${sizeClasses[size]} leading-none ${className}`}>
        {emojiArray.map((emoji, index) => (
          <Tooltip key={index}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => handleEmojiClick(emoji, e)}
                className="hover:scale-125 transition-transform duration-200 cursor-pointer focus:outline-none focus:scale-125"
                aria-label={`Search for artworks with ${emoji}`}
              >
                {emoji}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Search for artworks with {emoji}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  );
}