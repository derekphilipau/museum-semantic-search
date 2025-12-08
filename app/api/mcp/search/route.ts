import { NextRequest, NextResponse } from 'next/server';
import { embedJinaText } from '@/lib/embeddings';
import {
  performKeywordSearch,
  performHybridSearchWithEmbeddings,
  performSemanticSearchWithEmbedding,
} from '@/lib/elasticsearch/client';
import { getCachedEmbeddings, setCachedEmbeddings } from '@/lib/embeddings/cache';
import {
  DetailLevel,
  MCPFilters,
  MCPArtworkResult,
  MCPSearchHit,
  transformSearchHits,
  convertFilters,
  buildFiltersApplied,
  CORS_HEADERS_POST,
} from '@/lib/mcp';

// ============================================================================
// MCP Request/Response Types
// ============================================================================

interface MCPSearchRequest {
  query: string;
  filters?: MCPFilters;
  mode?: 'auto' | 'keyword' | 'semantic' | 'hybrid';
  limit?: number;
  offset?: number;
  detail?: DetailLevel;
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
  results: MCPArtworkResult[];
}

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
      detail = 'standard',
    } = body;

    // Validate query
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json(
        { error: 'query is required and must be a non-empty string' },
        { status: 400, headers: CORS_HEADERS_POST }
      );
    }

    // Clamp limit and offset to valid ranges
    const size = Math.min(Math.max(1, limit), 50);
    const startOffset = Math.min(Math.max(0, offset), 200);

    // We need to fetch offset + size results to support pagination
    const fetchSize = Math.min(startOffset + size, 250);

    // Convert filters
    const searchFilters = convertFilters(filters);
    const filtersApplied = buildFiltersApplied(searchFilters);

    let searchResults;
    let modeUsed = mode;

    // Execute search based on mode
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
          true,
          0.5,
          searchFilters
        );
        modeUsed = 'hybrid';
      } else {
        // Fallback to keyword if embedding failed
        searchResults = await performKeywordSearch(query, fetchSize, true, searchFilters);
        modeUsed = 'keyword';
      }
    }

    // Apply pagination
    const paginatedHits = searchResults.hits.slice(startOffset, startOffset + size) as MCPSearchHit[];
    const hasMore = searchResults.total > startOffset + size;

    // Transform results using shared function
    const results = transformSearchHits(paginatedHits, detail);

    const response: MCPSearchResponse = {
      meta: {
        query,
        mode: modeUsed,
        total: searchResults.total,
        returned: results.length,
        offset: startOffset,
        limit: size,
        has_more: hasMore,
        filters_applied: filtersApplied,
        processing_time_ms: Date.now() - startTime,
      },
      results,
    };

    return NextResponse.json(response, { headers: CORS_HEADERS_POST });
  } catch (error: unknown) {
    console.error('MCP Search Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: CORS_HEADERS_POST }
    );
  }
}

// ============================================================================
// CORS Preflight Handler
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS_POST,
  });
}
