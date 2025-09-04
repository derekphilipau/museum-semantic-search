'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface EmojiItem {
  emoji: string;
  count: number;
}

const INITIAL_DISPLAY_COUNT = 12;

export default function EmojiPalette() {
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT);

  useEffect(() => {
    fetchEmojis();
  }, []);

  const fetchEmojis = async () => {
    try {
      const response = await fetch('/api/emojis');
      
      if (!response.ok) {
        console.error('Failed to fetch emojis:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Error response:', errorText);
        setLoading(false);
        return;
      }
      
      const data = await response.json();
      console.log('Emoji data received:', data);
      setEmojis(data.emojis || []);
    } catch (error) {
      console.error('Failed to fetch emojis:', error);
    } finally {
      setLoading(false);
    }
  };

  const displayedEmojis = emojis.slice(0, displayCount);

  if (loading) {
    return (
      <div className="w-full">
        Loading Emojis...
      </div>
    );
  }

  if (emojis.length === 0) {
    return null;
  }

  // Emoji button component
  const EmojiButton = ({ item }: { item: EmojiItem }) => {
    const searchParams = new URLSearchParams({
      q: item.emoji
    });
    
    return (
      <Link
        href={`/?${searchParams.toString()}`}
        className="group inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent transition-colors"
        aria-label={`Search for ${item.emoji} (${item.count} artworks)`}
      >
        <span className="text-lg group-hover:scale-110 transition-transform">
          {item.emoji}
        </span>
        <span className="text-xs text-muted-foreground">
          {item.count}
        </span>
      </Link>
    );
  };

  return (
    <div className="w-full">
      <div className="space-y-2">
          <div className="flex flex-wrap gap-0 items-center">
            <div className="text-sm font-medium">
              {emojis.length} Emojis:
            </div>
            {displayedEmojis.map((item, index) => (
              <EmojiButton key={index} item={item} />
            ))}
            {emojis.length > displayCount && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setDisplayCount(emojis.length)}
              >
                Show All {emojis.length}
              </Button>
            )}
          </div>
        </div>
    </div>
  );
}