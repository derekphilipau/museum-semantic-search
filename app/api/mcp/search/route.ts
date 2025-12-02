import { NextRequest, NextResponse } from 'next/server';
import { embedJinaText } from '@/lib/embeddings';
import {
  performKeywordSearch,
  performHybridSearchWithEmbeddings,
  performSemanticSearchWithEmbedding,
  SearchFilters,
} from '@/lib/elasticsearch/client';
import { getCachedEmbeddings, setCachedEmbeddings } from '@/lib/embeddings/cache';
import { ArtworkImage } from '@/app/types';

// ============================================================================
// MCP Request/Response Types
// ============================================================================

interface MCPSearchRequest {
  /** The conceptual query (e.g., "sunflowers", "portraits of women") */
  query: string;

  /** Optional structured filters */
  filters?: {
    artistName?: string;
    yearStart?: number;
    yearEnd?: number;
    medium?: string;
    classification?: string;
    department?: string;
    tags?: string[];
    culture?: string;
    country?: string;
    onView?: boolean;
    isPublicDomain?: boolean;
  };

  /** Search mode: 'auto' | 'keyword' | 'semantic' | 'hybrid' (default: 'hybrid') */
  mode?: 'auto' | 'keyword' | 'semantic' | 'hybrid';

  /** Number of results to return (default: 10, max: 50) */
  limit?: number;

  /** Offset for pagination - skip first N results (default: 0, max: 200) */
  offset?: number;

  /** Include visual description in results (default: false) */
  includeDescription?: boolean;

  /** Include image URLs in results (default: true) */
  includeImage?: boolean;
}

interface MCPSearchResult {
  id: string;
  score: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  classification?: string;
  department?: string;
  image_url?: string;
  thumbnail_url?: string;
  description?: string;
  alt_text?: string;
  tags?: string[];
  culture?: string;
  source_url?: string;
}

interface MCPSearchResponse {
  meta: {
    query: string;
    mode: string;
    total: number;
    returned: number;
    offset: number;
    limit: number;
    has_more: boolean;
    filters_applied: Record<string, string | number | boolean | string[]>;
    processing_time_ms: number;
  };
  results: MCPSearchResult[];
}

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: MCPSearchRequest = await request.json();
    const {
      query,
      filters = {},
      mode = 'hybrid',
      limit = 10,
      offset = 0,
      includeDescription = false,
      includeImage = true,
    } = body;

    // Validate query
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json(
        { error: 'query is required and must be a non-empty string' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Clamp limit and offset to valid ranges
    const size = Math.min(Math.max(1, limit), 50);
    const startOffset = Math.min(Math.max(0, offset), 200);

    // We need to fetch offset + size results to support pagination
    // Then slice to return only the requested page
    const fetchSize = Math.min(startOffset + size, 250); // Cap total fetch at 250

    // Convert MCP filters to internal SearchFilters
    const searchFilters: SearchFilters = {};

    if (filters.artistName) searchFilters.artistName = filters.artistName;
    if (filters.yearStart !== undefined) searchFilters.yearStart = filters.yearStart;
    if (filters.yearEnd !== undefined) searchFilters.yearEnd = filters.yearEnd;
    if (filters.medium) searchFilters.medium = filters.medium;
    if (filters.classification) searchFilters.classification = filters.classification;
    if (filters.department) searchFilters.department = filters.department;
    if (filters.tags && filters.tags.length > 0) searchFilters.tags = filters.tags;
    if (filters.culture) searchFilters.culture = filters.culture;
    if (filters.country) searchFilters.country = filters.country;
    if (filters.onView !== undefined) searchFilters.onView = filters.onView;
    if (filters.isPublicDomain !== undefined) searchFilters.isPublicDomain = filters.isPublicDomain;

    // Build filters_applied for response (only include set filters)
    const filtersApplied: Record<string, string | number | boolean | string[]> = {};
    Object.entries(searchFilters).forEach(([key, value]) => {
      if (value !== undefined) {
        filtersApplied[key] = value as string | number | boolean | string[];
      }
    });

    let searchResults;
    let modeUsed = mode;

    // Execute search based on mode
    // Fetch enough results to support pagination (offset + limit)
    if (mode === 'keyword') {
      searchResults = await performKeywordSearch(query, fetchSize, true, searchFilters);
    } else {
      // For semantic/hybrid/auto, we need embeddings
      let embedding: number[] | undefined;

      // Check cache first
      const cached = await getCachedEmbeddings(query);
      if (cached?.jina_text) {
        embedding = cached.jina_text;
      } else {
        try {
          const result = await embedJinaText(query);
          embedding = result.values;
          // Cache for future use (fire and forget)
          setCachedEmbeddings(query, { jina_text: result.values }).catch(console.error);
        } catch (e) {
          console.error('Embedding generation failed, falling back to keyword:', e);
          modeUsed = 'keyword';
        }
      }

      if (embedding && mode === 'semantic') {
        searchResults = await performSemanticSearchWithEmbedding(
          embedding,
          'jina_text',
          fetchSize,
          searchFilters
        );
      } else if (embedding) {
        // hybrid or auto with successful embedding
        searchResults = await performHybridSearchWithEmbeddings(
          query,
          { jina_text: embedding },
          'jina_text',
          fetchSize,
          true, // includeDescriptions for better keyword matching
          0.5,  // balanced hybrid
          searchFilters
        );
        modeUsed = 'hybrid';
      } else {
        // Fallback to keyword if embedding failed
        searchResults = await performKeywordSearch(query, fetchSize, true, searchFilters);
        modeUsed = 'keyword';
      }
    }

    // Apply pagination: slice results based on offset
    const paginatedHits = searchResults.hits.slice(startOffset, startOffset + size);
    const hasMore = searchResults.total > startOffset + size;

    // Build response
    const response: MCPSearchResponse = {
      meta: {
        query,
        mode: modeUsed,
        total: searchResults.total,
        returned: paginatedHits.length,
        offset: startOffset,
        limit: size,
        has_more: hasMore,
        filters_applied: filtersApplied,
        processing_time_ms: Date.now() - startTime,
      },
      results: paginatedHits.map((hit) => {
        const source = hit._source;

        // Handle image field (can be string or object)
        const imageData: ArtworkImage | undefined =
          typeof source.image === 'string'
            ? { url: source.image }
            : source.image;

        const result: MCPSearchResult = {
          id: hit._id,
          score: hit._score,
          title: source.title,
          artist: source.artist,
          date: source.date,
          medium: source.medium,
        };

        // Optional fields
        if (source.classification) result.classification = source.classification;
        if (source.department) result.department = source.department;

        if (includeImage && imageData?.url) {
          result.image_url = imageData.url;
          if (imageData.thumbnailUrl) result.thumbnail_url = imageData.thumbnailUrl;
        }

        if (includeDescription && source.visual_description) {
          result.description = source.visual_description.long_description;
          result.alt_text = source.visual_description.alt_text;
        }

        if (source.tags && source.tags.length > 0) {
          result.tags = source.tags;
        }

        if (source.culture) result.culture = source.culture;
        if (source.sourceUrl) result.source_url = source.sourceUrl;

        return result;
      }),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (error: unknown) {
    console.error('MCP Search Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ============================================================================
// CORS Preflight Handler
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}
