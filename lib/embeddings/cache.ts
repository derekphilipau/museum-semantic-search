import { createClient } from '@vercel/kv';
import crypto from 'crypto';

// Create KV client with proper environment variables
const kvUrl = process.env.KV_KV_REST_API_URL || process.env.KV_REST_API_URL;
const kvToken = process.env.KV_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

console.log('[Cache] Initializing KV client:', {
  url: kvUrl ? kvUrl.substring(0, 30) + '...' : 'NOT SET',
  token: kvToken ? 'SET' : 'NOT SET',
  usingDoublePrefix: !!process.env.KV_KV_REST_API_URL,
  usingSinglePrefix: !!process.env.KV_REST_API_URL,
});

const kv = createClient({
  url: kvUrl,
  token: kvToken,
});

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
  // More robust production detection
  return process.env.NODE_ENV === 'production' || 
         process.env.VERCEL === '1' || 
         !!process.env.VERCEL_ENV;
}

// Check if KV is available
function isKVAvailable(): boolean {
  // Upstash/Vercel sometimes doubles the KV prefix
  return !!(process.env.KV_KV_REST_API_URL && process.env.KV_KV_REST_API_TOKEN) ||
         !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function getCachedEmbeddings(query: string): Promise<CachedEmbedding | null> {
  const key = getCacheKey(query);
  
  try {
    // Try KV first if available (works in both dev and prod if configured)
    if (isKVAvailable()) {
      console.log(`[Cache] KV is available, checking for query: "${query}" with key: ${key}`);
      try {
        const cached = await kv.get<CachedEmbedding>(key);
        console.log(`[Cache] KV lookup completed for key ${key}:`, cached ? 'Found' : 'Not found');
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[Cache] KV hit for query: "${query}" (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
        
        // Refresh TTL for frequently accessed items
        // Only refresh if entry is older than 1 hour to avoid excessive writes
        if (Date.now() - cached.timestamp > 60 * 60 * 1000) {
          const refreshed = { ...cached, timestamp: Date.now() };
          await kv.set(key, refreshed, { ex: Math.floor(CACHE_TTL / 1000) });
            console.log(`[Cache] Refreshed TTL for query: "${query}"`);
          }
          
          return cached;
        } else if (cached) {
          console.log(`[Cache] KV entry expired for query: "${query}" (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
        }
      } catch (kvError) {
        console.error(`[Cache] KV lookup error for query "${query}":`, kvError);
      }
    } else if (isProduction()) {
      console.log(`[Cache] WARNING: KV not available in production. Check KV_KV_REST_API_URL and KV_KV_REST_API_TOKEN environment variables.`);
    }
    
    // Fall back to memory cache (useful in both development and as production fallback)
    if (!isProduction() || !isKVAvailable()) {
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
      const ttlSeconds = Math.floor(CACHE_TTL / 1000);
      console.log(`[Cache] Attempting to store in KV for query: "${query}" with TTL: ${ttlSeconds}s`);
      await kv.set(key, data, { ex: ttlSeconds });
      console.log(`[Cache] Successfully stored in KV for query: "${query}" (key: ${key})`);
    } else if (isProduction()) {
      console.log(`[Cache] WARNING: Cannot store in KV (not available) for query: "${query}"`);
      console.log('[Cache] Debug - KV availability:', {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        KV_KV_REST_API_URL: !!process.env.KV_KV_REST_API_URL,
        KV_KV_REST_API_TOKEN: !!process.env.KV_KV_REST_API_TOKEN,
      });
    }
    
    // Store in memory cache as fallback or for development
    if (!isProduction() || !isKVAvailable()) {
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
    isProduction: isProduction(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      KV_KV_REST_API_URL: process.env.KV_KV_REST_API_URL ? 'Set' : 'Not set',
      KV_KV_REST_API_TOKEN: process.env.KV_KV_REST_API_TOKEN ? 'Set' : 'Not set'
    }
  };
}