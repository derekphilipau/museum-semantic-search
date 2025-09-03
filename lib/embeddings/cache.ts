import { kv } from '@vercel/kv';
import crypto from 'crypto';

// Types
interface CachedEmbedding {
  siglip2: number[];
  jina_v3: number[];
  timestamp: number;
}

// In-memory cache for development
const memoryCache = new Map<string, CachedEmbedding>();

// Cache configuration
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const MAX_MEMORY_CACHE_SIZE = 1000; // Limit memory cache size

// Generate cache key from query
export function getCacheKey(query: string): string {
  // Create a hash of the query for consistent keys
  return crypto.createHash('md5').update(query.toLowerCase().trim()).digest('hex');
}

// Check if we're in production (Vercel)
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.VERCEL === '1';
}

// Check if KV is available
function isKVAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function getCachedEmbeddings(query: string): Promise<CachedEmbedding | null> {
  const key = getCacheKey(query);
  
  try {
    // Try KV first if available (works in both dev and prod if configured)
    if (isKVAvailable()) {
      const cached = await kv.get<CachedEmbedding>(key);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Cache] KV hit for query: "${query}"`);
        
        // Refresh TTL for frequently accessed items
        // Only refresh if entry is older than 1 hour to avoid excessive writes
        if (Date.now() - cached.timestamp > 60 * 60 * 1000) {
          const refreshed = { ...cached, timestamp: Date.now() };
          await kv.set(key, refreshed, { ex: Math.floor(CACHE_TTL / 1000) });
          console.log(`[Cache] Refreshed TTL for query: "${query}"`);
        }
        
        return cached;
      }
    }
    
    // Fall back to memory cache (especially useful in development)
    if (!isProduction()) {
      const cached = memoryCache.get(key);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Cache] Memory hit for query: "${query}"`);
        
        // Refresh timestamp in memory cache
        // For memory cache, we can refresh on every access since it's free
        cached.timestamp = Date.now();
        // Re-insert to update LRU position
        memoryCache.delete(key);
        memoryCache.set(key, cached);
        
        return cached;
      }
    }
  } catch (error) {
    console.error('[Cache] Error reading from cache:', error);
  }
  
  console.log(`[Cache] Miss for query: "${query}"`);
  return null;
}

export async function setCachedEmbeddings(
  query: string, 
  embeddings: { siglip2: number[]; jina_v3: number[] }
): Promise<void> {
  const key = getCacheKey(query);
  const data: CachedEmbedding = {
    ...embeddings,
    timestamp: Date.now()
  };
  
  try {
    // Store in KV if available
    if (isKVAvailable()) {
      // Set with TTL in seconds
      await kv.set(key, data, { ex: Math.floor(CACHE_TTL / 1000) });
      console.log(`[Cache] Stored in KV for query: "${query}"`);
    }
    
    // Also store in memory cache for development
    if (!isProduction()) {
      // Implement simple LRU by removing oldest entries if cache is too large
      if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
        const firstKey = memoryCache.keys().next().value;
        if (firstKey !== undefined) {
          memoryCache.delete(firstKey);
        }
      }
      memoryCache.set(key, data);
      console.log(`[Cache] Stored in memory for query: "${query}" (size: ${memoryCache.size})`);
    }
  } catch (error) {
    console.error('[Cache] Error writing to cache:', error);
    // Don't throw - caching errors shouldn't break the app
  }
}

// Optional: Clear old entries from memory cache periodically
if (!isProduction()) {
  setInterval(() => {
    const now = Date.now();
    let cleared = 0;
    for (const [key, value] of memoryCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        memoryCache.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(`[Cache] Cleared ${cleared} expired entries from memory cache`);
    }
  }, 60 * 60 * 1000); // Check every hour
}

// Export cache stats for monitoring
export function getCacheStats() {
  return {
    memorySize: memoryCache.size,
    isKVAvailable: isKVAvailable(),
    isProduction: isProduction()
  };
}