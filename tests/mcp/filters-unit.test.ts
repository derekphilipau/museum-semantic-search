import { describe, it, expect } from 'vitest';
import { convertFilters, buildFiltersApplied } from '@/lib/mcp/filters';
import { MCPFilters } from '@/lib/mcp/types';

describe('MCP Filters', () => {
  // ==========================================================================
  // convertFilters
  // ==========================================================================
  describe('convertFilters', () => {
    it('should return empty object for undefined input', () => {
      const result = convertFilters(undefined);
      expect(result).toEqual({});
    });

    it('should return empty object for empty filter object', () => {
      const result = convertFilters({});
      expect(result).toEqual({});
    });

    it('should convert all filter fields', () => {
      const filters: MCPFilters = {
        artistName: 'Van Gogh',
        yearStart: 1880,
        yearEnd: 1890,
        medium: 'Oil on canvas',
        classification: 'Paintings',
        department: 'European Paintings',
        tags: ['Landscapes', 'Portraits'],
        culture: 'Dutch',
        country: 'France',
        onView: true,
        isPublicDomain: true,
      };

      const result = convertFilters(filters);

      expect(result).toEqual({
        artistName: 'Van Gogh',
        yearStart: 1880,
        yearEnd: 1890,
        medium: 'Oil on canvas',
        classification: 'Paintings',
        department: 'European Paintings',
        tags: ['Landscapes', 'Portraits'],
        culture: 'Dutch',
        country: 'France',
        onView: true,
        isPublicDomain: true,
      });
    });

    it('should ignore undefined filter values', () => {
      const filters: MCPFilters = {
        artistName: 'Van Gogh',
        yearStart: undefined,
        classification: undefined,
      };

      const result = convertFilters(filters);

      expect(result).toEqual({
        artistName: 'Van Gogh',
      });
    });

    it('should handle year value of 0', () => {
      const filters: MCPFilters = {
        yearStart: 0,
        yearEnd: 100,
      };

      const result = convertFilters(filters);

      expect(result.yearStart).toBe(0);
      expect(result.yearEnd).toBe(100);
    });

    it('should handle boolean false values', () => {
      const filters: MCPFilters = {
        onView: false,
        isPublicDomain: false,
      };

      const result = convertFilters(filters);

      expect(result.onView).toBe(false);
      expect(result.isPublicDomain).toBe(false);
    });

    it('should ignore empty tags array', () => {
      const filters: MCPFilters = {
        tags: [],
      };

      const result = convertFilters(filters);

      expect(result.tags).toBeUndefined();
    });

    it('should include non-empty tags array', () => {
      const filters: MCPFilters = {
        tags: ['Portraits'],
      };

      const result = convertFilters(filters);

      expect(result.tags).toEqual(['Portraits']);
    });
  });

  // ==========================================================================
  // buildFiltersApplied
  // ==========================================================================
  describe('buildFiltersApplied', () => {
    it('should return empty object for empty filters', () => {
      const result = buildFiltersApplied({});
      expect(result).toEqual({});
    });

    it('should include all defined filter values', () => {
      const filters = {
        artistName: 'Van Gogh',
        yearStart: 1880,
        yearEnd: 1890,
        department: 'European Paintings',
      };

      const result = buildFiltersApplied(filters);

      expect(result).toEqual({
        artistName: 'Van Gogh',
        yearStart: 1880,
        yearEnd: 1890,
        department: 'European Paintings',
      });
    });

    it('should handle array values', () => {
      const filters = {
        tags: ['Portraits', 'Women'],
      };

      const result = buildFiltersApplied(filters);

      expect(result.tags).toEqual(['Portraits', 'Women']);
    });

    it('should handle boolean values', () => {
      const filters = {
        onView: true,
        isPublicDomain: false,
      };

      const result = buildFiltersApplied(filters);

      expect(result.onView).toBe(true);
      expect(result.isPublicDomain).toBe(false);
    });
  });
});
