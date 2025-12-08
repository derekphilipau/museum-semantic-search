import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the elasticsearch client
vi.mock('@/lib/elasticsearch/client', () => ({
  getFilterOptions: vi.fn(),
  searchFilterOptions: vi.fn(),
}));

import { GET } from '@/app/api/mcp/filters/route';
import * as esClient from '@/lib/elasticsearch/client';

// Helper to create a mock request
function createRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/mcp/filters');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

describe('MCP Filters API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFilterOptions = {
    departments: [
      { value: 'European Paintings', count: 500 },
      { value: 'American Art', count: 300 },
      { value: '', count: 10 }, // Empty value to filter out
    ],
    classifications: [
      { value: 'Paintings', count: 800 },
      { value: 'Sculpture', count: 200 },
    ],
    cultures: [
      { value: 'French', count: 150 },
      { value: 'Dutch', count: 100 },
      { value: 'Italian', count: 90 },
    ],
    mediums: [
      { value: 'Oil on canvas', count: 1500 },
      { value: 'Watercolor', count: 200 },
      { value: 'Oil on wood', count: 150 },
      { value: '', count: 3 }, // Empty value to filter out
    ],
    tags: [
      { value: 'Portraits', count: 250 },
      { value: 'Landscapes', count: 200 },
      { value: 'Still Life', count: 100 },
      { value: '', count: 5 }, // Empty value to filter out
    ],
    dateRange: {
      min: 1400,
      max: 2024,
    },
  };

  it('should return filter options', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.departments).toBeDefined();
    expect(data.classifications).toBeDefined();
    expect(data.cultures).toBeDefined();
    expect(data.mediums).toBeDefined();
    expect(data.tags).toBeDefined();
    expect(data.date_range).toBeDefined();
  });

  it('should filter out empty values from departments', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.departments).toHaveLength(2);
    expect(data.departments.every((d: { value: string }) => d.value !== '')).toBe(true);
  });

  it('should filter out empty values from tags', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tags).toHaveLength(3);
    expect(data.tags.every((t: { value: string }) => t.value !== '')).toBe(true);
  });

  it('should filter out empty values from mediums', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.mediums).toHaveLength(3);
    expect(data.mediums.every((m: { value: string }) => m.value !== '')).toBe(true);
  });

  it('should include date range', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.date_range.min).toBe(1400);
    expect(data.date_range.max).toBe(2024);
  });

  it('should include schema information for agents', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema).toBeDefined();
    expect(data.schema.artistName).toBeDefined();
    expect(data.schema.artistName.type).toBe('string');
    expect(data.schema.artistName.description).toContain('fuzzy');
  });

  it('should include year range in schema', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema.yearStart.type).toBe('number');
    expect(data.schema.yearStart.min).toBe(1400);
    expect(data.schema.yearStart.max).toBe(2024);
    expect(data.schema.yearEnd.type).toBe('number');
    expect(data.schema.yearEnd.min).toBe(1400);
    expect(data.schema.yearEnd.max).toBe(2024);
  });

  it('should include enum values for department', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema.department.type).toBe('string');
    expect(data.schema.department.enum).toContain('European Paintings');
    expect(data.schema.department.enum).toContain('American Art');
    expect(data.schema.department.enum).not.toContain('');
  });

  it('should include boolean filter descriptions', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema.onView.type).toBe('boolean');
    expect(data.schema.onView.description).toContain('on display');
    expect(data.schema.isPublicDomain.type).toBe('boolean');
    expect(data.schema.isPublicDomain.description).toContain('public domain');
  });

  it('should include example artist names', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema.artistName.examples).toBeDefined();
    expect(Array.isArray(data.schema.artistName.examples)).toBe(true);
    expect(data.schema.artistName.examples.length).toBeGreaterThan(0);
  });

  it('should include medium schema with examples', async () => {
    vi.mocked(esClient.getFilterOptions).mockResolvedValue(mockFilterOptions);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.schema.medium).toBeDefined();
    expect(data.schema.medium.type).toBe('string');
    expect(data.schema.medium.description).toContain('fuzzy');
    expect(data.schema.medium.examples).toBeDefined();
    expect(Array.isArray(data.schema.medium.examples)).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(esClient.getFilterOptions).mockRejectedValue(new Error('ES connection failed'));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
  });

  // New tests for search functionality
  describe('search mode', () => {
    it('should search filter values when search param provided', async () => {
      vi.mocked(esClient.searchFilterOptions).mockResolvedValue({
        cultures: [
          { value: 'Japan', count: 100 },
          { value: 'probably Japan', count: 5 },
        ],
      });

      const response = await GET(createRequest({ search: 'japan' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.search_query).toBe('japan');
      expect(data.field_filter).toBe('all');
      expect(data.results.cultures).toHaveLength(2);
      expect(esClient.searchFilterOptions).toHaveBeenCalledWith('japan', undefined, 20);
    });

    it('should filter by specific field when field param provided', async () => {
      vi.mocked(esClient.searchFilterOptions).mockResolvedValue({
        tags: [
          { value: 'Portraits', count: 250 },
          { value: 'Self-portraits', count: 16 },
        ],
      });

      const response = await GET(createRequest({ search: 'portrait', field: 'tags' }));
      const data = await response.json();

      expect(data.field_filter).toBe('tags');
      expect(esClient.searchFilterOptions).toHaveBeenCalledWith('portrait', 'tags', 20);
    });

    it('should respect limit parameter', async () => {
      vi.mocked(esClient.searchFilterOptions).mockResolvedValue({});

      await GET(createRequest({ search: 'test', limit: '50' }));

      expect(esClient.searchFilterOptions).toHaveBeenCalledWith('test', undefined, 50);
    });

    it('should clamp limit to max 100', async () => {
      vi.mocked(esClient.searchFilterOptions).mockResolvedValue({});

      await GET(createRequest({ search: 'test', limit: '500' }));

      expect(esClient.searchFilterOptions).toHaveBeenCalledWith('test', undefined, 100);
    });

    it('should return error for invalid field', async () => {
      const response = await GET(createRequest({ search: 'test', field: 'invalid' }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid field');
    });
  });
});
