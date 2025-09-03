import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';

export interface MetImageCacheEntry {
  object_id: string;
  primaryImage: string;
  primaryImageSmall: string;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  hasImage: boolean;
  fetched_at: string;
}

export interface MetImageCache {
  [objectId: string]: MetImageCacheEntry;
}

export async function loadMetImageCache(): Promise<MetImageCache> {
  const cachePath = path.join(process.cwd(), 'data', 'met', 'met_image_urls_cache.jsonl');
  const cache: MetImageCache = {};
  
  try {
    await fs.access(cachePath);
    
    const fileStream = createReadStream(cachePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line) as MetImageCacheEntry;
          cache[entry.object_id] = entry;
        } catch (e) {
          console.warn('Invalid JSON line in cache:', e);
        }
      }
    }
    
    return cache;
  } catch (error) {
    console.warn('Met image cache not found. Run: python3 scripts/met/fetch-met-image-urls.py');
    return {};
  }
}