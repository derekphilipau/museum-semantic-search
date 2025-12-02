import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the elasticsearch client
vi.mock('@/lib/elasticsearch/client', () => ({
  getArtworkById: vi.fn(),
}));

import { GET } from '@/app/api/mcp/artwork/[id]/route';
import * as esClient from '@/lib/elasticsearch/client';

describe('MCP Artwork API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockArtwork = {
    title: 'Starry Night',
    titles: ['Starry Night', 'La Nuit étoilée'],
    artist: 'Vincent van Gogh',
    artists: [
      {
        constituentId: '12345',
        displayName: 'Vincent van Gogh',
        role: 'Artist',
        displayBio: 'Dutch, 1853–1890',
        nationality: 'Dutch',
        beginDate: 1853,
        endDate: 1890,
      },
    ],
    date: '1889',
    dateBegin: 1889,
    dateEnd: 1889,
    medium: 'Oil on canvas',
    dimensions: '73.7 cm × 92.1 cm',
    creditLine: 'Acquired through the Lillie P. Bliss Bequest',
    collection: 'met',
    collectionId: '436535',
    sourceUrl: 'https://metmuseum.org/art/collection/436535',
    classification: 'Paintings',
    department: 'European Paintings',
    objectName: 'Painting',
    culture: 'Dutch',
    period: 'Post-Impressionist',
    country: 'France',
    region: 'Europe',
    accessionYear: 1941,
    isPublicDomain: true,
    isHighlight: true,
    onView: true,
    galleryNumber: '822',
    image: {
      url: 'https://example.com/starry-night.jpg',
      thumbnailUrl: 'https://example.com/starry-night-thumb.jpg',
      width: 2000,
      height: 1600,
    },
    visual_description: {
      alt_text: 'A swirling night sky over a village',
      long_description: 'The painting depicts a swirling night sky...',
      emoji_summary: '🌙⭐🏘️🌀',
      emoji_array: ['🌙', '⭐', '🏘️', '🌀'],
      metadata: { model: 'gemini-2.5-flash', generated_at: '2024-01-01' },
    },
    tags: ['Landscapes', 'Night', 'Stars'],
    similar_artworks: [
      {
        id: 'met_789',
        similarity_type: 'style',
        confidence: 0.85,
        explanation: 'Similar post-impressionist style',
        source: 'jina_clip',
      },
    ],
  };

  it('should return artwork details for valid ID', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('met_436535');
    expect(data.title).toBe('Starry Night');
    expect(data.artist).toBe('Vincent van Gogh');
  });

  it('should include artist details', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.artists).toHaveLength(1);
    expect(data.artists[0].id).toBe('12345');
    expect(data.artists[0].name).toBe('Vincent van Gogh');
    expect(data.artists[0].nationality).toBe('Dutch');
    expect(data.artists[0].birth_year).toBe(1853);
    expect(data.artists[0].death_year).toBe(1890);
  });

  it('should include date range', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.date).toBe('1889');
    expect(data.date_start).toBe(1889);
    expect(data.date_end).toBe(1889);
  });

  it('should include image data', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.image.url).toBe('https://example.com/starry-night.jpg');
    expect(data.image.thumbnail_url).toBe('https://example.com/starry-night-thumb.jpg');
    expect(data.image.width).toBe(2000);
    expect(data.image.height).toBe(1600);
  });

  it('should include visual description', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.description.alt_text).toBe('A swirling night sky over a village');
    expect(data.description.long_description).toContain('swirling night sky');
    expect(data.description.emoji_summary).toBe('🌙⭐🏘️🌀');
  });

  it('should include similar artworks', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.similar_artworks).toHaveLength(1);
    expect(data.similar_artworks[0].id).toBe('met_789');
    expect(data.similar_artworks[0].similarity_type).toBe('style');
    expect(data.similar_artworks[0].confidence).toBe(0.85);
  });

  it('should return 404 for non-existent artwork', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/nonexistent');
    const response = await GET(request, { params: Promise.resolve({ id: 'nonexistent' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  it('should handle artwork with string image', async () => {
    const artworkWithStringImage = {
      ...mockArtwork,
      image: 'https://example.com/simple-image.jpg',
    };
    vi.mocked(esClient.getArtworkById).mockResolvedValue(artworkWithStringImage);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_123');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_123' }) });
    const data = await response.json();

    expect(data.image.url).toBe('https://example.com/simple-image.jpg');
  });

  it('should include status flags', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.is_public_domain).toBe(true);
    expect(data.is_highlight).toBe(true);
    expect(data.on_view).toBe(true);
    expect(data.gallery_number).toBe('822');
  });

  it('should include cultural context', async () => {
    vi.mocked(esClient.getArtworkById).mockResolvedValue(mockArtwork);

    const request = new NextRequest('http://localhost:3000/api/mcp/artwork/met_436535');
    const response = await GET(request, { params: Promise.resolve({ id: 'met_436535' }) });
    const data = await response.json();

    expect(data.culture).toBe('Dutch');
    expect(data.period).toBe('Post-Impressionist');
    expect(data.country).toBe('France');
    expect(data.region).toBe('Europe');
  });
});
