import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the elasticsearch client
vi.mock('@/lib/elasticsearch/client', () => ({
  performKeywordSearch: vi.fn(),
  performSemanticSearchWithEmbedding: vi.fn(),
  performHybridSearchWithEmbeddings: vi.fn(),
  SearchFilters: {},
}));

// Mock embeddings
vi.mock('@/lib/embeddings', () => ({
  embedJinaText: vi.fn(),
  EMBEDDING_MODELS: {
    jina_text: { name: 'Jina Text', dimension: 1024 },
    jina_clip: { name: 'Jina CLIP', dimension: 1024 },
  },
}));

// Mock cache
vi.mock('@/lib/embeddings/cache', () => ({
  getCachedEmbeddings: vi.fn(),
  setCachedEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/mcp/search/route';
import * as esClient from '@/lib/elasticsearch/client';
import * as embeddings from '@/lib/embeddings';
import * as cache from '@/lib/embeddings/cache';

describe('MCP Search API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSearchResults = {
    took: 10,
    total: 2,
    hits: [
      {
        _id: 'met_123',
        _score: 0.95,
        _source: {
          title: 'Starry Night',
          artist: 'Vincent van Gogh',
          date: '1889',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          department: 'European Paintings',
          image: { url: 'https://example.com/image.jpg', thumbnailUrl: 'https://example.com/thumb.jpg' },
          tags: ['Landscapes', 'Night'],
          culture: 'Dutch',
          sourceUrl: 'https://metmuseum.org/art/collection/123',
        },
      },
      {
        _id: 'met_456',
        _score: 0.85,
        _source: {
          title: 'Sunflowers',
          artist: 'Vincent van Gogh',
          date: '1888',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          department: 'European Paintings',
          image: 'https://example.com/image2.jpg',
          tags: ['Still Life', 'Flowers'],
        },
      },
    ],
  };

  it('should require a query parameter', async () => {
    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('query is required');
  });

  it('should perform keyword search when mode is keyword', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'starry night',
        mode: 'keyword',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta.query).toBe('starry night');
    expect(data.meta.mode).toBe('keyword');
    expect(data.results).toHaveLength(2);
    expect(data.results[0].title).toBe('Starry Night');
    expect(esClient.performKeywordSearch).toHaveBeenCalledWith('starry night', 10, true, {});
  });

  it('should perform hybrid search by default', async () => {
    vi.mocked(cache.getCachedEmbeddings).mockResolvedValue(null);
    vi.mocked(embeddings.embedJinaText).mockResolvedValue({ values: [0.1, 0.2, 0.3], dimension: 1024 });
    vi.mocked(esClient.performHybridSearchWithEmbeddings).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'impressionist landscape',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta.mode).toBe('hybrid');
    expect(esClient.performHybridSearchWithEmbeddings).toHaveBeenCalled();
  });

  it('should use cached embeddings when available', async () => {
    vi.mocked(cache.getCachedEmbeddings).mockResolvedValue({
      jina_text: [0.1, 0.2, 0.3],
    });
    vi.mocked(esClient.performHybridSearchWithEmbeddings).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'cached query',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(embeddings.embedJinaText).not.toHaveBeenCalled();
    expect(cache.getCachedEmbeddings).toHaveBeenCalledWith('cached query');
  });

  it('should apply filters correctly', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'paintings',
        mode: 'keyword',
        filters: {
          artistName: 'Van Gogh',
          yearStart: 1880,
          yearEnd: 1890,
          department: 'European Paintings',
        },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta.filters_applied).toEqual({
      artistName: 'Van Gogh',
      yearStart: 1880,
      yearEnd: 1890,
      department: 'European Paintings',
    });
  });

  it('should respect limit parameter', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'test',
        mode: 'keyword',
        limit: 25,
      }),
    });

    await POST(request);

    expect(esClient.performKeywordSearch).toHaveBeenCalledWith('test', 25, true, {});
  });

  it('should clamp limit to max 50', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'test',
        mode: 'keyword',
        limit: 100,
      }),
    });

    await POST(request);

    expect(esClient.performKeywordSearch).toHaveBeenCalledWith('test', 50, true, {});
  });

  it('should fall back to keyword search if embedding fails', async () => {
    vi.mocked(cache.getCachedEmbeddings).mockResolvedValue(null);
    vi.mocked(embeddings.embedJinaText).mockRejectedValue(new Error('API error'));
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'test query',
        mode: 'hybrid',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.meta.mode).toBe('keyword');
    expect(esClient.performKeywordSearch).toHaveBeenCalled();
  });

  it('should include image URLs by default', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'test',
        mode: 'keyword',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.results[0].image_url).toBe('https://example.com/image.jpg');
    expect(data.results[0].thumbnail_url).toBe('https://example.com/thumb.jpg');
  });

  it('should handle string image field', async () => {
    vi.mocked(esClient.performKeywordSearch).mockResolvedValue(mockSearchResults);

    const request = new NextRequest('http://localhost:3000/api/mcp/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'test',
        mode: 'keyword',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    // Second result has string image
    expect(data.results[1].image_url).toBe('https://example.com/image2.jpg');
  });
});
