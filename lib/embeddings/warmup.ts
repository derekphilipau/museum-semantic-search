// Warmup function to pre-warm Modal containers
export async function warmupEmbeddingService() {
  const modalUrl = process.env.MODAL_EMBEDDING_URL;
  if (!modalUrl) {
    console.log('MODAL_EMBEDDING_URL not set, skipping warmup');
    return;
  }

  try {
    console.log('Warming up Modal embedding service...');
    
    // Call the warmup endpoint
    const warmupResponse = await fetch(`${modalUrl}/warmup`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (warmupResponse.ok) {
      const result = await warmupResponse.json();
      console.log('Modal warmup result:', result);
      
      // If container is cold, trigger a test embedding to warm it up
      if (result.status === 'cold' || !result.container_ready) {
        console.log('Container is cold, triggering test embedding...');
        
        const testResponse = await fetch(`${modalUrl}/embed_text`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'warmup test query' }),
        });

        if (testResponse.ok) {
          console.log('Test embedding generated, container should be warm now');
        }
      }
    }
  } catch (error) {
    console.error('Error warming up Modal service:', error);
  }
}

// Function to periodically keep containers warm
export function startPeriodicWarmup(intervalMinutes: number = 8) {
  // Initial warmup
  warmupEmbeddingService();
  
  // Set up periodic warmup (8 minutes by default, before the 10-minute timeout)
  const intervalMs = intervalMinutes * 60 * 1000;
  
  const intervalId = setInterval(() => {
    warmupEmbeddingService();
  }, intervalMs);

  // Return cleanup function
  return () => clearInterval(intervalId);
}