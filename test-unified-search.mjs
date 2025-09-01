// Test the unified search API
const API_URL = 'http://localhost:3000/api/search';

const testSearch = async () => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'abstract',
        options: {
          keyword: true,
          models: {
            jina_embeddings_v4: true,
            google_vertex_multimodal: true
          },
          hybrid: true
        },
        size: 5
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Error:', response.status, error);
      return;
    }

    const data = await response.json();
    
    console.log('Search Results:');
    console.log('==============');
    
    // Keyword results
    if (data.keyword) {
      console.log('\nKeyword Search:', data.keyword.total, 'results');
      console.log('First result:', data.keyword.hits[0]?._source?.metadata?.title);
    }
    
    // Semantic results
    Object.entries(data.semantic).forEach(([model, results]) => {
      console.log(`\n${model} Semantic:`, results.total, 'results');
      console.log('First result:', results.hits[0]?._source?.metadata?.title);
    });
    
    // Hybrid results
    if (data.hybrid) {
      console.log(`\nHybrid (${data.hybrid.model}):`, data.hybrid.results.total, 'results');
      console.log('First result:', data.hybrid.results.hits[0]?._source?.metadata?.title);
    }
    
  } catch (error) {
    console.error('Request failed:', error);
  }
};

// Run the test
console.log('Testing unified search API...\n');
testSearch();