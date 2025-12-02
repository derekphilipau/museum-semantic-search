import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the elasticsearch client
vi.mock('@/lib/elasticsearch/client', () => ({
  getArtworkById: vi.fn(),
  findSimilarArtworks: vi.fn(),
  findMetadataSimilarArtworks: vi.fn(),
  findCombinedSimilarArtworks: vi.fn(),
  hydrateSimilarArtworks: vi.fn(),
}));

import { GET, POST } from '@/app/api/mcp/similar/[id]/route';
import * as esClient from '@/lib/elasticsearch/client';

describe('MCP Similar Artworks API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSourceArtwork = {
    title: 'Starry Night',
    artist: 'Vincent van Gogh',
    date: '1889',
    medium: 'Oil on canvas',
    similar_artworks: [
      {
        id: 'met_789',
        similarity_type: 'style',
        confidence: 0.85,
        explanation: 'Similar post-impressionist style',
        source: 'jina_clip',
      },
      {
        id: 'met_101',
        similarity_type: 'subject',
        confidence: 0.75,
        explanation: 'Both depict night scenes',
        source: 'metadata',
      },
    ],
  };

  const mockSearchResults = {
    took: 15,
    total: 2,
    hits: [
      {
        _id: 'met_789',
        _score: 0.85,
        _source: {
          title: 'Café Terrace at Night',
          artist: 'Vincent van Gogh',
          date: '1888',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          image: { url: 'https://example.com/cafe.jpg', thumbnailUrl: 'https://example.com/cafe-thumb.jpg' },
        },
      },
      {
        _id: 'met_101',
        _score: 0.75,
        _source: {
          title: 'The Night Watch',
          artist: 'Rembrandt',
          date: '1642',
          medium: 'Oil on canvas',
          classification: 'Paintings',
          image: 'https://example.com/night-watch.jpg',
        },
      },
    ],
  };

  const mockHydratedResults = [
    {
      _id: 'met_789',
      _score: 0.85,
      _source: {
        title: 'Café Terrace at Night',
        artist: 'Vincent van Gogh',
        date: '1888',
        medium: 'Oil on canvas',
        classification: 'Paintings',
        image: { url: 'https://example.com/cafe.jpg' },
        _similarityInfo: {
          similarity_type: 'style',
          explanation: 'Similar post-impressionist style',
        },
      },
    },
    {
      _id: 'met_101',
      _score: 0.75,
      _source: {
        title: 'The Night Watch',
        artist: 'Rembrandt',
        date: '1642',
        medium: 'Oil on canvas',
        classification: 'Paintings',
        image: 'https://example.com/night-watch.jpg',
        _similarityInfo: {
          similarity_type: 'subject',
          explanation: 'Both depict night scenes',
        },
      },
    },
  ];

  describe('GET requests', () => {
    it('should return precomputed similar artworks by default', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.hydrateSimilarArtworks).mockResolvedValue(mockHydratedResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('precomputed');
      expect(data.meta.source_artwork.id).toBe('met_436535');
      expect(data.meta.source_artwork.title).toBe('Starry Night');
      expect(data.results).toHaveLength(2);
    });

    it('should use embedding method when specified', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=embedding&model=jina_clip');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('embedding');
      expect(data.meta.model).toBe('jina_clip');
      expect(esClient.findSimilarArtworks).toHaveBeenCalledWith('met_436535', 'jina_clip', 10);
    });

    it('should use metadata method when specified', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findMetadataSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=metadata');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('metadata');
      expect(esClient.findMetadataSimilarArtworks).toHaveBeenCalledWith('met_436535', 10);
    });

    it('should respect limit parameter', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=embedding&limit=25');
      await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });

      expect(esClient.findSimilarArtworks).toHaveBeenCalledWith('met_436535', 'jina_clip', 25);
    });
  });

  describe('POST requests', () => {
    it('should accept JSON body', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findCombinedSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535', {
        method: 'POST',
        body: JSON.stringify({ method: 'combined', limit: 20 }),
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('combined');
      expect(esClient.findCombinedSimilarArtworks).toHaveBeenCalledWith('met_436535', ['jina_text', 'jina_clip'], 20);
    });

    it('should handle empty body gracefully', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.hydrateSimilarArtworks).mockResolvedValue(mockHydratedResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535', {
        method: 'POST',
        body: '{}',
      });
      const response = await POST(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('precomputed');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for non-existent artwork', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/nonexistent');
      const response = await GET(request, { params: Promise.resolve({ id: 'nonexistent' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });

    it('should return 400 for invalid method', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=invalid');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid method');
    });

    it('should fall back to embedding if no precomputed results', async () => {
      const artworkWithoutSimilar = { ...mockSourceArtwork, similar_artworks: undefined };
      vi.mocked(esClient.getArtworkById).mockResolvedValue(artworkWithoutSimilar);
      vi.mocked(esClient.findSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.meta.method).toBe('embedding');
      expect(data.meta.model).toBe('jina_clip');
    });
  });

  describe('Result formatting', () => {
    it('should include similarity explanation when available', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.hydrateSimilarArtworks).mockResolvedValue(mockHydratedResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(data.results[0].similarity_type).toBe('style');
      expect(data.results[0].similarity_explanation).toBe('Similar post-impressionist style');
    });

    it('should include image URLs by default', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=embedding');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(data.results[0].image_url).toBe('https://example.com/cafe.jpg');
      expect(data.results[0].thumbnail_url).toBe('https://example.com/cafe-thumb.jpg');
    });

    it('should exclude images when includeImage is false', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.findSimilarArtworks).mockResolvedValue(mockSearchResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535?method=embedding&includeImage=false');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(data.results[0].image_url).toBeUndefined();
    });

    it('should include processing time', async () => {
      vi.mocked(esClient.getArtworkById).mockResolvedValue(mockSourceArtwork);
      vi.mocked(esClient.hydrateSimilarArtworks).mockResolvedValue(mockHydratedResults);

      const request = new NextRequest('http://localhost:3000/api/mcp/similar/met_436535');
      const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
      const data = await response.json();

      expect(data.meta.processing_time_ms).toBeDefined();
      expect(typeof data.meta.processing_time_ms).toBe('number');
    });
  });
});
