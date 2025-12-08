import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { embedJinaText, embedJinaClipImage } from '@/lib/embeddings';
import {
  performKeywordSearch,
  performHybridSearchWithEmbeddings,
  performSemanticSearchWithEmbedding,
  getArtworkById,
  findSimilarArtworks,
  getFilterOptions,
  searchFilterOptions,
} from '@/lib/elasticsearch/client';
import { getCachedEmbeddings, setCachedEmbeddings } from '@/lib/embeddings/cache';
import {
  DetailLevel,
  MCPSearchHit,
  transformSearchHits,
  transformArtwork,
  convertFilters,
} from '@/lib/mcp';

// ============================================================================
// Shared Schemas
// ============================================================================

const FiltersSchema = z.object({
  artistName: z.string().optional().describe('Artist name (fuzzy matched). Use "First Last" format, e.g., "Vincent van Gogh", "Rembrandt van Rijn"'),
  yearStart: z.number().int().optional().describe('Start year for date range'),
  yearEnd: z.number().int().optional().describe('End year for date range'),
  medium: z.string().optional().describe('Materials/technique (fuzzy matched)'),
  classification: z.string().optional().describe('Artwork type (exact match)'),
  department: z.string().optional().describe('Museum department (exact match)'),
  tags: z.array(z.string()).optional().describe('Tags/keywords (exact match)'),
  culture: z.string().optional().describe('Cultural origin (exact match)'),
  country: z.string().optional().describe('Country of origin (exact match)'),
  onView: z.boolean().optional().describe('Currently on display'),
  isPublicDomain: z.boolean().optional().describe('Public domain status'),
}).optional();

const DetailSchema = z.enum(['minimal', 'standard', 'full']).default('standard')
  .describe('Detail level: minimal (id/title/artist/date), standard (+ images/tags/classification), full (all fields including description)');

// ============================================================================
// MCP Handler
// ============================================================================

const handler = createMcpHandler(
  (server) => {
    // ========================================================================
    // Tool: search_artworks
    // ========================================================================
    server.tool(
      'search_artworks',
      `Search the Met Museum Open Access Paintings collection (~2,300 paintings).

SEARCH MODES:
- "hybrid" (default): Best for most queries. Combines keyword matching with semantic understanding.
- "semantic": Best for conceptual queries like "lonely figure in nature" or "vibrant celebration".
- "keyword": Best for exact matches like artist names or specific titles.

DETAIL LEVELS:
Control how much information is returned per artwork:
- "minimal": Just id, score, title, artist, date (fastest, smallest response)
- "standard" (default): + medium, classification, department, tags, culture, images, source_url
- "full": + dimensions, artists array, date range, AI visual description, similar_artworks, etc.

WHEN TO USE EACH LEVEL:
- "standard": General browsing, showing results to users
- "full": When you need to evaluate results semantically (e.g., "find paintings with three women
  and horses" - use the long_description to verify matches), or when you need complete details
  without a separate get_artwork call

TIPS:
- Call get_filter_options first to see valid department/classification/culture values
- Use filters to narrow results (e.g., artistName: "Van Gogh", yearStart: 1880, yearEnd: 1890)
- Use offset for pagination when has_more is true`,
      {
        query: z.string().min(1).describe('Search query text (e.g., "sunflowers", "portraits of women", "impressionist landscapes")'),
        filters: FiltersSchema,
        mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid').describe('Search mode: keyword (exact text), semantic (conceptual), or hybrid (both)'),
        detail: DetailSchema,
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return'),
        offset: z.number().int().min(0).max(200).default(0).describe('Offset for pagination'),
      },
      async ({ query, filters, mode, detail, limit, offset }) => {
        const searchFilters = convertFilters(filters);
        const fetchSize = Math.min(offset + limit, 250);

        let searchResults;
        let modeUsed = mode;

        if (mode === 'keyword') {
          searchResults = await performKeywordSearch(query, fetchSize, true, searchFilters);
        } else {
          let embedding: number[] | undefined;
          const cached = await getCachedEmbeddings(query);
          if (cached?.jina_text) {
            embedding = cached.jina_text;
          } else {
            try {
              const result = await embedJinaText(query);
              embedding = result.values;
              setCachedEmbeddings(query, { jina_text: result.values }).catch(console.error);
            } catch (e) {
              console.error('Embedding generation failed, falling back to keyword:', e);
              modeUsed = 'keyword';
            }
          }

          if (embedding && mode === 'semantic') {
            searchResults = await performSemanticSearchWithEmbedding(embedding, 'jina_text', fetchSize, searchFilters);
          } else if (embedding) {
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
            searchResults = await performKeywordSearch(query, fetchSize, true, searchFilters);
            modeUsed = 'keyword';
          }
        }

        const paginatedHits = searchResults.hits.slice(offset, offset + limit) as MCPSearchHit[];
        const hasMore = searchResults.total > offset + limit;
        const results = transformSearchHits(paginatedHits, detail as DetailLevel);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                meta: {
                  query,
                  mode: modeUsed,
                  total: searchResults.total,
                  returned: results.length,
                  offset,
                  limit,
                  has_more: hasMore,
                },
                results,
              }, null, 2),
            },
          ],
        };
      }
    );

    // ========================================================================
    // Tool: get_artwork
    // ========================================================================
    server.tool(
      'get_artwork',
      `Get complete details for a specific artwork by ID.

Returns: title, artist info, dates, medium, dimensions, department, classification, culture,
AI-generated visual description (alt_text, long_description, emoji_summary), tags,
similar artworks, and image URLs.

Use this to get full details on a specific artwork. Alternatively, use search_artworks with
detail="full" to get complete details inline with search results.`,
      {
        id: z.string().min(1).describe('Artwork ID (e.g., "met_436524")'),
      },
      async ({ id }) => {
        const artwork = await getArtworkById(id);

        if (!artwork) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Artwork not found' }) }],
            isError: true,
          };
        }

        const result = transformArtwork(artwork, id);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
    );

    // ========================================================================
    // Tool: find_similar
    // ========================================================================
    server.tool(
      'find_similar',
      `Find artworks similar to a given artwork.

METHODS:
- "precomputed" (default): LLM-curated similarities with explanations. Higher quality, includes reasoning.
- "embedding": Vector similarity search. Use with model "jina_clip" (visual) or "jina_text" (conceptual).

Use this to explore related artworks after finding an interesting piece.`,
      {
        id: z.string().min(1).describe('Source artwork ID (e.g., "met_436524")'),
        method: z.enum(['precomputed', 'embedding']).default('precomputed').describe('Similarity method: precomputed (LLM-curated, higher quality) or embedding (vector similarity)'),
        model: z.enum(['jina_text', 'jina_clip']).default('jina_clip').describe('Embedding model for embedding method: jina_text (conceptual) or jina_clip (visual)'),
        limit: z.number().int().min(1).max(50).default(10).describe('Number of similar artworks to return'),
      },
      async ({ id, method, model, limit }) => {
        const artwork = await getArtworkById(id);

        if (!artwork) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Artwork not found' }) }],
            isError: true,
          };
        }

        let results: Array<{
          id: string;
          score?: number;
          title?: string;
          artist?: string;
          similarity_type?: string;
          similarity_explanation?: string;
        }> = [];
        let methodUsed = method;

        if (method === 'precomputed' && artwork.similar_artworks && artwork.similar_artworks.length > 0) {
          results = artwork.similar_artworks.slice(0, limit).map((sim) => ({
            id: sim.id,
            score: sim.confidence,
            similarity_type: sim.similarity_type,
            similarity_explanation: sim.explanation,
          }));
        } else {
          methodUsed = 'embedding';
          const similar = await findSimilarArtworks(id, model, limit);
          results = similar.hits.map((hit) => ({
            id: hit._id,
            score: hit._score,
            title: hit._source.title,
            artist: hit._source.artist,
          }));
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                meta: {
                  source_artwork: {
                    id,
                    title: artwork.title,
                    artist: artwork.artist,
                  },
                  method: methodUsed,
                  model: methodUsed === 'embedding' ? model : null,
                  returned: results.length,
                },
                results,
              }, null, 2),
            },
          ],
        };
      }
    );

    // ========================================================================
    // Tool: search_by_image
    // ========================================================================
    server.tool(
      'search_by_image',
      `Search for visually similar artworks by uploading an image.

Provide a base64-encoded image (with or without data URL prefix) to find paintings with similar visual characteristics like composition, color palette, or style.

Supports JPEG, PNG, and other common image formats.`,
      {
        image: z.string().min(1).describe('Base64-encoded image (with or without data URL prefix like "data:image/jpeg;base64,...")'),
        filters: FiltersSchema,
        detail: DetailSchema,
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return'),
      },
      async ({ image, filters, detail, limit }) => {
        const searchFilters = convertFilters(filters);

        // Extract base64 data (remove data URL prefix if present)
        let base64Data = image;
        let mimeType = 'image/jpeg';
        const dataUrlMatch = image.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          mimeType = dataUrlMatch[1];
          base64Data = dataUrlMatch[2];
        }

        try {
          const embedding = await embedJinaClipImage(base64Data, mimeType);
          const searchResults = await performSemanticSearchWithEmbedding(
            embedding.values,
            'jina_clip',
            limit,
            Object.keys(searchFilters).length > 0 ? searchFilters : undefined
          );

          const results = transformSearchHits(searchResults.hits as MCPSearchHit[], detail as DetailLevel);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  meta: {
                    method: 'image_embedding',
                    model: 'jina_clip',
                    total: searchResults.total,
                    returned: results.length,
                  },
                  results,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image embedding failed';
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      }
    );

    // ========================================================================
    // Tool: get_filter_options
    // ========================================================================
    server.tool(
      'get_filter_options',
      `Get available filter values for the Met Museum Open Access Paintings collection.

Returns (when no search query provided):
- departments: Museum departments (e.g., "European Paintings", "American Paintings")
- classifications: Artwork types (mostly "Paintings" in this collection)
- cultures: Cultural origins (e.g., "French", "Dutch", "American")
- mediums: Materials/techniques (e.g., "Oil on canvas", "Watercolor", "Oil on copper")
- tags: Subject tags (e.g., "Portraits", "Landscapes", "Women")
- date_range: Min/max years in the collection

SEARCH MODE: Provide a "search" query to find specific filter values (case-insensitive).
Example: search="japan" returns cultures like "Japan", "probably Japan", "China or Japan", etc.
Example: search="oil" returns mediums like "Oil on canvas", "Oil on wood", "Oil on copper", etc.
Optionally specify "field" to search only specific field(s).

IMPORTANT: Call this to discover valid filter values before using search_artworks with filters.`,
      {
        search: z.string().optional().describe('Case-insensitive search string to find matching filter values (e.g., "japan", "portrait", "oil")'),
        field: z.enum(['departments', 'classifications', 'cultures', 'mediums', 'tags', 'countries', 'periods'])
          .optional()
          .describe('Limit search to a specific field. If omitted, searches all fields.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Max results per field when searching (default 20)'),
      },
      async ({ search, field, limit }) => {
        if (search) {
          // Search mode: find filter values matching the query
          const results = await searchFilterOptions(search, field, limit);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  search_query: search,
                  field_filter: field || 'all',
                  results,
                }, null, 2),
              },
            ],
          };
        }

        // Default mode: return all top filter values
        const options = await getFilterOptions();

        const result = {
          departments: options.departments,
          classifications: options.classifications,
          cultures: options.cultures,
          mediums: options.mediums,
          tags: options.tags,
          date_range: {
            min: options.dateRange.min,
            max: options.dateRange.max,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  },
  {
    serverInfo: {
      name: 'museum-semantic-search',
      version: '1.0.0',
    },
  },
  {
    basePath: '/api',
    verboseLogs: process.env.NODE_ENV === 'development',
  }
);

export { handler as GET, handler as POST, handler as DELETE };
