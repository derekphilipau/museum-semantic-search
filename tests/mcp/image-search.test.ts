import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the elasticsearch client
vi.mock('@/lib/elasticsearch/client', () => ({
  performSemanticSearchWithEmbedding: vi.fn(),
  SearchFilters: {},
}));

// Mock embeddings
vi.mock('@/lib/embeddings', () => ({
  embedJinaClipImage: vi.fn(),
}));

import { POST } from '@/app/api/mcp/image-search/route';
import * as esClient from '@/lib/elasticsearch/client';
import * as embeddings from '@/lib/embeddings';

describe('MCP Image Search API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSearchResults = {
    took: 25,
    total: 3,
    hits: [
      {
        _id: 'met_123',
        _score: 0.92,
        _source: {
          title: 'Starry Night',
          artist: 'Vincent van Gogh',
          date: '1889',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          department: 'European Paintings',
          image: { url: 'https://example.com/starry.jpg', thumbnailUrl: 'https://example.com/starry-thumb.jpg' },
          tags: ['Landscapes', 'Night'],
          culture: 'Dutch',
          sourceUrl: 'https://metmuseum.org/123',
        },
      },
      {
        _id: 'met_456',
        _score: 0.85,
        _source: {
          title: 'Moonrise',
          artist: 'Another Artist',
          date: '1900',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          image: 'https://example.com/moonrise.jpg',
        },
      },
    ],
  };

  const mockEmbedding = { values: [0.1, 0.2, 0.3, 0.4], dimension: 1024 };

  it('should require an image parameter', async () => {
    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('image is required');
  });

  it('should process base64 image with data URL prefix', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(embeddings.embedJinaClipImage).toHaveBeenCalledWith('/9j/4AAQSkZJRg==', 'image/jpeg');
    expect(data.results).toHaveLength(2);
  });

  it('should process raw base64 image', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: '/9j/4AAQSkZJRg==',
        mimeType: 'image/png',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(embeddings.embedJinaClipImage).toHaveBeenCalledWith('/9j/4AAQSkZJRg==', 'image/png');
  });

  it('should default to image/jpeg mime type', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: '/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(embeddings.embedJinaClipImage).toHaveBeenCalledWith('/9j/4AAQSkZJRg==', 'image/jpeg');
  });

  it('should include meta information in response', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.meta.method).toBe('image_embedding');
    expect(data.meta.model).toBe('jina_clip');
    expect(data.meta.total).toBe(3);
    expect(data.meta.returned).toBe(2);
    expect(data.meta.processing_time_ms).toBeDefined();
    expect(data.meta.embedding_time_ms).toBeDefined();
  });

  it('should apply filters', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        filters: {
          classification: 'Paintings',
          yearStart: 1850,
          yearEnd: 1900,
        },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta.filters_applied).toEqual({
      classification: 'Paintings',
      yearStart: 1850,
      yearEnd: 1900,
    });
    expect(esClient.performSemanticSearchWithEmbedding).toHaveBeenCalledWith(
      mockEmbedding.values,
      'jina_clip',
      10,
      expect.objectContaining({
        classification: 'Paintings',
        yearStart: 1850,
        yearEnd: 1900,
      })
    );
  });

  it('should respect limit parameter', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        limit: 25,
      }),
    });

    await POST(request);

    expect(esClient.performSemanticSearchWithEmbedding).toHaveBeenCalledWith(
      mockEmbedding.values,
      'jina_clip',
      25,
      undefined
    );
  });

  it('should clamp limit to max 50', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        limit: 100,
      }),
    });

    await POST(request);

    expect(esClient.performSemanticSearchWithEmbedding).toHaveBeenCalledWith(
      mockEmbedding.values,
      'jina_clip',
      50,
      undefined
    );
  });

  it('should include image URLs by default', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.results[0].image_url).toBe('https://example.com/starry.jpg');
    expect(data.results[0].thumbnail_url).toBe('https://example.com/starry-thumb.jpg');
  });

  it('should return minimal fields when detail is minimal', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        detail: 'minimal',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    // Minimal should only have id, score, title, artist, date
    expect(data.results[0].id).toBe('met_123');
    expect(data.results[0].title).toBe('Starry Night');
    expect(data.results[0].artist).toBe('Vincent van Gogh');
    expect(data.results[0].date).toBe('1889');
    // Should NOT have standard fields
    expect(data.results[0].image_url).toBeUndefined();
    expect(data.results[0].thumbnail_url).toBeUndefined();
    expect(data.results[0].medium).toBeUndefined();
    expect(data.results[0].tags).toBeUndefined();
  });

  it('should handle string image field', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    // Second result has string image
    expect(data.results[1].image_url).toBe('https://example.com/moonrise.jpg');
  });

  it('should include tags when available', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockResolvedValue(mockEmbedding);
    vi.mocked(esClient.performSemanticSearchWithEmbedding).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.results[0].tags).toEqual(['Landscapes', 'Night']);
  });

  it('should handle embedding API errors', async () => {
    vi.mocked(embeddings.embedJinaClipImage).mockRejectedValue(new Error('Jina API error'));

    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Jina API error');
  });

  it('should return invalid image data error for empty base64', async () => {
    const request = new NextRequest('http://localhost:3000/api/mcp/image-search', {
      method: 'POST',
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid image data');
  });
});
