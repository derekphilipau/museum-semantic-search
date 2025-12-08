import { describe, it, expect } from 'vitest';
import {
  transformArtist,
  transformImage,
  transformDescription,
  transformSimilarArtwork,
  transformSearchHit,
  transformSearchHits,
  transformArtwork,
  normalizeImage,
} from '@/lib/mcp/transforms';
import { Artist, ArtworkImage, Artwork } from '@/app/types';
import { MCPSearchHit } from '@/lib/mcp/types';

describe('MCP Transforms', () => {
  // ==========================================================================
  // transformArtist
  // ==========================================================================
  describe('transformArtist', () => {
    it('should transform artist with all fields', () => {
      const artist: Artist = {
        constituentId: '12345',
        displayName: 'Vincent van Gogh',
        role: 'Artist',
        displayBio: 'Dutch, 1853–1890',
        nationality: 'Dutch',
        beginDate: 1853,
        endDate: 1890,
      };

      const result = transformArtist(artist);

      expect(result).toEqual({
        id: '12345',
        name: 'Vincent van Gogh',
        role: 'Artist',
        bio: 'Dutch, 1853–1890',
        nationality: 'Dutch',
        birth_year: 1853,
        death_year: 1890,
      });
    });

    it('should handle artist with minimal fields', () => {
      const artist: Artist = {
        displayName: 'Unknown Artist',
      };

      const result = transformArtist(artist);

      expect(result.name).toBe('Unknown Artist');
      expect(result.id).toBeUndefined();
      expect(result.role).toBeUndefined();
    });
  });

  // ==========================================================================
  // transformImage
  // ==========================================================================
  describe('transformImage', () => {
    it('should transform image with all fields', () => {
      const image: ArtworkImage = {
        url: 'https://example.com/image.jpg',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        width: 2000,
        height: 1500,
      };

      const result = transformImage(image);

      expect(result).toEqual({
        url: 'https://example.com/image.jpg',
        thumbnail_url: 'https://example.com/thumb.jpg',
        width: 2000,
        height: 1500,
      });
    });

    it('should handle image with only url', () => {
      const image: ArtworkImage = {
        url: 'https://example.com/image.jpg',
      };

      const result = transformImage(image);

      expect(result.url).toBe('https://example.com/image.jpg');
      expect(result.thumbnail_url).toBeUndefined();
      expect(result.width).toBeUndefined();
    });
  });

  // ==========================================================================
  // normalizeImage
  // ==========================================================================
  describe('normalizeImage', () => {
    it('should return undefined for undefined input', () => {
      expect(normalizeImage(undefined)).toBeUndefined();
    });

    it('should convert string to ArtworkImage', () => {
      const result = normalizeImage('https://example.com/image.jpg');

      expect(result).toEqual({ url: 'https://example.com/image.jpg' });
    });

    it('should pass through ArtworkImage object', () => {
      const image: ArtworkImage = {
        url: 'https://example.com/image.jpg',
        width: 1000,
      };

      const result = normalizeImage(image);

      expect(result).toBe(image);
    });
  });

  // ==========================================================================
  // transformDescription
  // ==========================================================================
  describe('transformDescription', () => {
    it('should transform description with all fields', () => {
      const desc = {
        alt_text: 'A beautiful painting',
        long_description: 'This painting depicts...',
        emoji_summary: '🎨🌅',
      };

      const result = transformDescription(desc);

      expect(result).toEqual({
        alt_text: 'A beautiful painting',
        long_description: 'This painting depicts...',
        emoji_summary: '🎨🌅',
      });
    });

    it('should handle partial description', () => {
      const desc = {
        alt_text: 'A painting',
      };

      const result = transformDescription(desc);

      expect(result.alt_text).toBe('A painting');
      expect(result.long_description).toBeUndefined();
    });
  });

  // ==========================================================================
  // transformSimilarArtwork
  // ==========================================================================
  describe('transformSimilarArtwork', () => {
    it('should transform similar artwork', () => {
      const similar = {
        id: 'met_789',
        similarity_type: 'style',
        confidence: 0.85,
        explanation: 'Similar brushwork and palette',
      };

      const result = transformSimilarArtwork(similar);

      expect(result).toEqual({
        id: 'met_789',
        similarity_type: 'style',
        confidence: 0.85,
        explanation: 'Similar brushwork and palette',
      });
    });
  });

  // ==========================================================================
  // transformSearchHit - Detail Levels
  // ==========================================================================
  describe('transformSearchHit', () => {
    const createMockHit = (overrides = {}): MCPSearchHit => ({
      _id: 'met_123',
      _score: 0.95,
      _source: {
        title: 'Starry Night',
        titles: ['Starry Night', 'La Nuit étoilée'],
        artist: 'Vincent van Gogh',
        artists: [{
          constituentId: '12345',
          displayName: 'Vincent van Gogh',
          role: 'Artist',
          nationality: 'Dutch',
          beginDate: 1853,
          endDate: 1890,
        }],
        date: '1889',
        dateBegin: 1889,
        dateEnd: 1889,
        medium: 'Oil on canvas',
        dimensions: '73.7 × 92.1 cm',
        classification: 'Paintings',
        department: 'European Paintings',
        objectName: 'Painting',
        image: {
          url: 'https://example.com/image.jpg',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          width: 2000,
          height: 1500,
        },
        visual_description: {
          alt_text: 'A swirling night sky',
          long_description: 'The painting depicts...',
          emoji_summary: '🌙⭐',
        },
        tags: ['Landscapes', 'Night'],
        culture: 'Dutch',
        period: 'Post-Impressionist',
        country: 'France',
        region: 'Europe',
        collection: 'met',
        collectionId: '436535',
        creditLine: 'Gift of Someone',
        accessionYear: 1941,
        isPublicDomain: true,
        isHighlight: true,
        onView: true,
        galleryNumber: '822',
        sourceUrl: 'https://metmuseum.org/art/123',
        similar_artworks: [{
          id: 'met_456',
          similarity_type: 'style',
          confidence: 0.9,
          explanation: 'Similar style',
        }],
        ...overrides,
      } as Artwork,
    });

    describe('minimal detail level', () => {
      it('should return only minimal fields', () => {
        const hit = createMockHit();
        const result = transformSearchHit(hit, 'minimal');

        expect(result.id).toBe('met_123');
        expect(result.score).toBe(0.95);
        expect(result.title).toBe('Starry Night');
        expect(result.artist).toBe('Vincent van Gogh');
        expect(result.date).toBe('1889');

        // Should NOT have standard fields
        expect(result.medium).toBeUndefined();
        expect(result.image_url).toBeUndefined();
        expect(result.tags).toBeUndefined();
        expect(result.classification).toBeUndefined();

        // Should NOT have full fields
        expect(result.artists).toBeUndefined();
        expect(result.description).toBeUndefined();
      });
    });

    describe('standard detail level', () => {
      it('should return minimal + standard fields', () => {
        const hit = createMockHit();
        const result = transformSearchHit(hit, 'standard');

        // Minimal fields
        expect(result.id).toBe('met_123');
        expect(result.title).toBe('Starry Night');

        // Standard fields
        expect(result.medium).toBe('Oil on canvas');
        expect(result.classification).toBe('Paintings');
        expect(result.department).toBe('European Paintings');
        expect(result.tags).toEqual(['Landscapes', 'Night']);
        expect(result.culture).toBe('Dutch');
        expect(result.image_url).toBe('https://example.com/image.jpg');
        expect(result.thumbnail_url).toBe('https://example.com/thumb.jpg');
        expect(result.source_url).toBe('https://metmuseum.org/art/123');

        // Should NOT have full fields
        expect(result.artists).toBeUndefined();
        expect(result.description).toBeUndefined();
        expect(result.dimensions).toBeUndefined();
      });

      it('should be the default detail level', () => {
        const hit = createMockHit();
        const result = transformSearchHit(hit); // no detail specified

        expect(result.medium).toBe('Oil on canvas');
        expect(result.artists).toBeUndefined();
      });
    });

    describe('full detail level', () => {
      it('should return all fields', () => {
        const hit = createMockHit();
        const result = transformSearchHit(hit, 'full');

        // Minimal fields
        expect(result.id).toBe('met_123');

        // Standard fields
        expect(result.medium).toBe('Oil on canvas');
        expect(result.image_url).toBe('https://example.com/image.jpg');

        // Full fields
        expect(result.titles).toEqual(['Starry Night', 'La Nuit étoilée']);
        expect(result.artists).toHaveLength(1);
        expect(result.artists![0].name).toBe('Vincent van Gogh');
        expect(result.artists![0].birth_year).toBe(1853);

        expect(result.date_start).toBe(1889);
        expect(result.date_end).toBe(1889);
        expect(result.dimensions).toBe('73.7 × 92.1 cm');
        expect(result.object_name).toBe('Painting');

        expect(result.period).toBe('Post-Impressionist');
        expect(result.country).toBe('France');
        expect(result.region).toBe('Europe');

        expect(result.collection).toBe('met');
        expect(result.collection_id).toBe('436535');
        expect(result.credit_line).toBe('Gift of Someone');
        expect(result.accession_year).toBe(1941);

        expect(result.is_public_domain).toBe(true);
        expect(result.is_highlight).toBe(true);
        expect(result.on_view).toBe(true);
        expect(result.gallery_number).toBe('822');

        expect(result.image).toEqual({
          url: 'https://example.com/image.jpg',
          thumbnail_url: 'https://example.com/thumb.jpg',
          width: 2000,
          height: 1500,
        });

        expect(result.description).toEqual({
          alt_text: 'A swirling night sky',
          long_description: 'The painting depicts...',
          emoji_summary: '🌙⭐',
        });

        expect(result.similar_artworks).toHaveLength(1);
        expect(result.similar_artworks![0].id).toBe('met_456');
      });

      it('should not include titles array if only one title', () => {
        const hit = createMockHit({ titles: ['Only One Title'] });
        const result = transformSearchHit(hit, 'full');

        expect(result.titles).toBeUndefined();
      });

      it('should handle missing optional fields gracefully', () => {
        const hit = createMockHit({
          visual_description: undefined,
          similar_artworks: undefined,
          artists: undefined,
          period: undefined,
        });
        const result = transformSearchHit(hit, 'full');

        expect(result.description).toBeUndefined();
        expect(result.similar_artworks).toBeUndefined();
        expect(result.artists).toBeUndefined();
        expect(result.period).toBeUndefined();
      });
    });

    describe('image handling', () => {
      it('should handle string image field', () => {
        const hit = createMockHit({ image: 'https://example.com/simple.jpg' });
        const result = transformSearchHit(hit, 'standard');

        expect(result.image_url).toBe('https://example.com/simple.jpg');
        expect(result.thumbnail_url).toBeUndefined();
      });

      it('should handle missing image', () => {
        const hit = createMockHit({ image: undefined });
        const result = transformSearchHit(hit, 'standard');

        expect(result.image_url).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // transformSearchHits (batch)
  // ==========================================================================
  describe('transformSearchHits', () => {
    it('should transform multiple hits', () => {
      const hits: MCPSearchHit[] = [
        {
          _id: 'met_1',
          _score: 0.9,
          _source: { title: 'Artwork 1', artist: 'Artist 1', date: '1900' } as Artwork,
        },
        {
          _id: 'met_2',
          _score: 0.8,
          _source: { title: 'Artwork 2', artist: 'Artist 2', date: '1901' } as Artwork,
        },
      ];

      const results = transformSearchHits(hits, 'minimal');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('met_1');
      expect(results[1].id).toBe('met_2');
    });
  });

  // ==========================================================================
  // transformArtwork
  // ==========================================================================
  describe('transformArtwork', () => {
    const mockArtwork: Artwork = {
      title: 'Starry Night',
      titles: ['Starry Night', 'La Nuit étoilée'],
      artist: 'Vincent van Gogh',
      artists: [{
        constituentId: '12345',
        displayName: 'Vincent van Gogh',
        role: 'Artist',
        nationality: 'Dutch',
        beginDate: 1853,
        endDate: 1890,
      }],
      date: '1889',
      dateBegin: 1889,
      dateEnd: 1889,
      medium: 'Oil on canvas',
      dimensions: '73.7 × 92.1 cm',
      classification: 'Paintings',
      department: 'European Paintings',
      objectName: 'Painting',
      image: {
        url: 'https://example.com/image.jpg',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        width: 2000,
        height: 1500,
      },
      visual_description: {
        alt_text: 'A swirling night sky',
        long_description: 'The painting depicts...',
        emoji_summary: '🌙⭐',
      },
      tags: ['Landscapes', 'Night'],
      culture: 'Dutch',
      period: 'Post-Impressionist',
      country: 'France',
      collection: 'met',
      collectionId: '436535',
      creditLine: 'Gift of Someone',
      accessionYear: 1941,
      isPublicDomain: true,
      sourceUrl: 'https://metmuseum.org/art/123',
      similar_artworks: [{
        id: 'met_456',
        similarity_type: 'style',
        confidence: 0.9,
        explanation: 'Similar style',
      }],
    };

    it('should transform artwork with all full-detail fields', () => {
      const result = transformArtwork(mockArtwork, 'met_123');

      expect(result.id).toBe('met_123');
      expect(result.title).toBe('Starry Night');
      expect(result.artist).toBe('Vincent van Gogh');
      expect(result.medium).toBe('Oil on canvas');

      // Full detail fields
      expect(result.titles).toEqual(['Starry Night', 'La Nuit étoilée']);
      expect(result.artists![0].name).toBe('Vincent van Gogh');
      expect(result.dimensions).toBe('73.7 × 92.1 cm');
      expect(result.description!.alt_text).toBe('A swirling night sky');
      expect(result.similar_artworks).toHaveLength(1);
    });

    it('should not have score field (only for search results)', () => {
      const result = transformArtwork(mockArtwork, 'met_123');

      expect(result.score).toBeUndefined();
    });

    it('should include convenience image_url fields', () => {
      const result = transformArtwork(mockArtwork, 'met_123');

      expect(result.image_url).toBe('https://example.com/image.jpg');
      expect(result.thumbnail_url).toBe('https://example.com/thumb.jpg');
      expect(result.image!.url).toBe('https://example.com/image.jpg');
    });
  });
});
