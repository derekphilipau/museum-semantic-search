import { createClient } from '@vercel/kv';

export async function GET() {
  console.log('[Test KV] Environment check:', {
    KV_REST_API_URL: process.env.KV_REST_API_URL ? 'SET' : 'NOT SET',
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? 'SET' : 'NOT SET',
    KV_KV_REST_API_URL: process.env.KV_KV_REST_API_URL ? 'SET' : 'NOT SET',
    KV_KV_REST_API_TOKEN: process.env.KV_KV_REST_API_TOKEN ? 'SET' : 'NOT SET',
  });

  const kvUrl = process.env.KV_KV_REST_API_URL || process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return Response.json({ 
      error: 'KV not configured',
      env: {
        hasUrl: !!kvUrl,
        hasToken: !!kvToken,
      }
    }, { status: 500 });
  }

  try {
    const kv = createClient({
      url: kvUrl,
      token: kvToken,
    });

    // Test write
    const testKey = 'test-' + Date.now();
    const testValue = { message: 'Hello from KV!', timestamp: new Date().toISOString() };
    
    console.log('[Test KV] Writing test key:', testKey);
    await kv.set(testKey, testValue, { ex: 60 }); // 60 second expiry
    
    // Test read
    console.log('[Test KV] Reading test key:', testKey);
    const retrieved = await kv.get(testKey);
    
    // Test delete
    console.log('[Test KV] Deleting test key:', testKey);
    await kv.del(testKey);

    return Response.json({
      success: true,
      testKey,
      written: testValue,
      retrieved,
      kvUrl: kvUrl.substring(0, 30) + '...',
    });
  } catch (error) {
    console.error('[Test KV] Error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}