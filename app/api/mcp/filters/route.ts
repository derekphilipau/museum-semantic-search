import { NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/elasticsearch/client';

// ============================================================================
// MCP Filters Response Types
// ============================================================================

interface MCPFiltersResponse {
  departments: Array<{ value: string; count: number }>;
  classifications: Array<{ value: string; count: number }>;
  cultures: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
  date_range: {
    min: number;
    max: number;
  };
  // Schema information for agents
  schema: {
    artistName: {
      type: 'string';
      description: 'Artist name (fuzzy matched)';
      examples: string[];
    };
    yearStart: {
      type: 'number';
      description: 'Start year for date range filter';
      min: number;
      max: number;
    };
    yearEnd: {
      type: 'number';
      description: 'End year for date range filter';
      min: number;
      max: number;
    };
    department: {
      type: 'string';
      description: 'Museum department (exact match)';
      enum: string[];
    };
    classification: {
      type: 'string';
      description: 'Artwork classification/type (exact match)';
      enum: string[];
    };
    culture: {
      type: 'string';
      description: 'Cultural origin (exact match)';
      enum: string[];
    };
    tags: {
      type: 'array';
      description: 'Tags/keywords (exact match, can specify multiple)';
      items: string[];
    };
    onView: {
      type: 'boolean';
      description: 'Filter to works currently on display';
    };
    isPublicDomain: {
      type: 'boolean';
      description: 'Filter to public domain works only';
    };
  };
}

// ============================================================================
// CORS Headers
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Main Handler
// ============================================================================

// Cache filter options for 1 hour (they don't change often)
export const revalidate = 3600;

export async function GET() {
  try {
    const filterOptions = await getFilterOptions();

    // Build response with schema information for agents
    const response: MCPFiltersResponse = {
      departments: filterOptions.departments.filter(d => d.value),
      classifications: filterOptions.classifications.filter(c => c.value),
      cultures: filterOptions.cultures.filter(c => c.value),
      tags: filterOptions.tags.filter(t => t.value),
      date_range: {
        min: filterOptions.dateRange.min,
        max: filterOptions.dateRange.max,
      },
      schema: {
        artistName: {
          type: 'string',
          description: 'Artist name (fuzzy matched)',
          examples: ['Van Gogh', 'Rembrandt', 'Monet', 'Picasso'],
        },
        yearStart: {
          type: 'number',
          description: 'Start year for date range filter',
          min: filterOptions.dateRange.min,
          max: filterOptions.dateRange.max,
        },
        yearEnd: {
          type: 'number',
          description: 'End year for date range filter',
          min: filterOptions.dateRange.min,
          max: filterOptions.dateRange.max,
        },
        department: {
          type: 'string',
          description: 'Museum department (exact match)',
          enum: filterOptions.departments.filter(d => d.value).map(d => d.value),
        },
        classification: {
          type: 'string',
          description: 'Artwork classification/type (exact match)',
          enum: filterOptions.classifications.filter(c => c.value).map(c => c.value),
        },
        culture: {
          type: 'string',
          description: 'Cultural origin (exact match)',
          enum: filterOptions.cultures.filter(c => c.value).slice(0, 50).map(c => c.value),
        },
        tags: {
          type: 'array',
          description: 'Tags/keywords (exact match, can specify multiple)',
          items: filterOptions.tags.filter(t => t.value).slice(0, 50).map(t => t.value),
        },
        onView: {
          type: 'boolean',
          description: 'Filter to works currently on display',
        },
        isPublicDomain: {
          type: 'boolean',
          description: 'Filter to public domain works only',
        },
      },
    };

    return NextResponse.json(response, {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error: unknown) {
    console.error('MCP Filters Error:', error);

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
