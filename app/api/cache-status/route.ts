import { getCacheStats } from '@/lib/embeddings/cache';

export async function GET() {
  return Response.json({
    stats: getCacheStats(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      KV_KV_URL_EXISTS: !!process.env.KV_KV_REST_API_URL,
      KV_KV_TOKEN_EXISTS: !!process.env.KV_KV_REST_API_TOKEN,
      KV_KV_URL_PREFIX: process.env.KV_KV_REST_API_URL?.substring(0, 20) + '...',
    }
  });
}