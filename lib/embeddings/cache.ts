import { createClient } from '@vercel/kv';
import crypto from 'crypto';

// Lazy initialization of KV client to ensure environment variables are loaded
let kv: ReturnType<typeof createClient> | null = null;

function getKVClient() {
  if (!kv) {
    const kvUrl = process.env.KV_KV_REST_API_URL;
    const kvToken = process.env.KV_KV_REST_API_TOKEN;
    
    
    if (kvUrl && kvToken) {
      kv = createClient({
        url: kvUrl,
        token: kvToken,
      });
    }
  }
  return kv;
}

// Types
interface CachedEmbedding {
  siglip2: number[];
  jina_v3: number[];
  timestamp: number;
}

// Cache configuration
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Generate cache key from query
export function getCacheKey(query: string): string {
  // Create a hash of the query for consistent keys
  const hash = crypto.createHash('md5').update(query.toLowerCase().trim()).digest('hex');
  return `emb:${hash}`;
}

// Check if KV is available
function isKVAvailable(): boolean {
  return !!(process.env.KV_KV_REST_API_URL && process.env.KV_KV_REST_API_TOKEN);
}

export async function getCachedEmbeddings(query: string): Promise<CachedEmbedding | null> {
  const key = getCacheKey(query);
  
  try {
    // Always use KV if available
    if (isKVAvailable()) {
      try {
        const kvClient = getKVClient();
        if (!kvClient) {
          throw new Error('KV client not initialized');
        }
        const cached = await kvClient.get<CachedEmbedding>(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        
        // Refresh TTL for frequently accessed items
        // Only refresh if entry is older than 1 hour to avoid excessive writes
        if (Date.now() - cached.timestamp > 60 * 60 * 1000) {
          const refreshed = { ...cached, timestamp: Date.now() };
          await kvClient.set(key, refreshed, { ex: Math.floor(CACHE_TTL / 1000) });
          }
          
          return cached;
        }
      } catch (kvError) {
        console.error('[Cache] KV lookup error:', kvError);
      }
    }
  } catch (error) {
    console.error('[Cache] Error reading from cache:', error);
  }
  
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
      const kvClient = getKVClient();
      if (!kvClient) {
        throw new Error('KV client not initialized');
      }
      await kvClient.set(key, data, { ex: ttlSeconds });
    }
  } catch (error) {
    console.error('[Cache] Error writing to cache:', error);
    // Don't throw - caching errors shouldn't break the app
  }
}

// Export cache stats for monitoring
export function getCacheStats() {
  return {
    isKVAvailable: isKVAvailable(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      KV_KV_REST_API_URL: process.env.KV_KV_REST_API_URL ? 'Set' : 'Not set',
      KV_KV_REST_API_TOKEN: process.env.KV_KV_REST_API_TOKEN ? 'Set' : 'Not set'
    }
  };
}