import { embedJinaText, embedJinaClipText } from './jina';

// Lightweight warmup that issues a single text + CLIP embedding call.
export async function warmupEmbeddingService() {
  try {
    await Promise.all([
      embedJinaText('warmup check'),
      embedJinaClipText('warmup check'),
    ]);
    console.log('[warmup] Embedding services ready');
  } catch (error) {
    console.error('[warmup] Warmup failed:', error);
  }
}

// Retained for compatibility; schedules periodic warmup calls if desired.
export function startPeriodicWarmup(intervalMinutes: number = 30) {
  warmupEmbeddingService();

  const intervalMs = Math.max(intervalMinutes, 5) * 60 * 1000;
  const intervalId = setInterval(() => {
    warmupEmbeddingService();
  }, intervalMs);

  return () => clearInterval(intervalId);
}
