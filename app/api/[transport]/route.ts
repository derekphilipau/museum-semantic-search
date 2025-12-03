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
  SearchFilters,
} from '@/lib/elasticsearch/client';
import { getCachedEmbeddings, setCachedEmbeddings } from '@/lib/embeddings/cache';
import { ArtworkImage, Artist } from '@/app/types';

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

// ============================================================================
// Helper Functions
// ============================================================================

function convertFilters(filters?: z.infer<typeof FiltersSchema>): SearchFilters {
  if (!filters) return {};
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
  return searchFilters;
}

interface SearchHit {
  _id: string;
  _score: number;
  _source: {
    title: string;
    artist: string;
    date: string;
    medium: string;
    classification?: string;
    department?: string;
    image?: string | ArtworkImage;
    visual_description?: {
      long_description?: string;
      alt_text?: string;
      emoji_summary?: string;
    };
    tags?: string[];
    culture?: string;
    sourceUrl?: string;
  };
}

type DescriptionLevel = 'none' | 'alt' | 'full'; // 'emoji' also available but commented out

function formatSearchResults(hits: SearchHit[], includeImage = true, descriptionLevel: DescriptionLevel = 'none') {
  return hits.map((hit) => {
    const source = hit._source;
    const imageData: ArtworkImage | undefined =
      typeof source.image === 'string' ? { url: source.image } : source.image;

    let description: { alt_text?: string; long_description?: string } | undefined;
    if (descriptionLevel !== 'none' && source.visual_description) {
      const vd = source.visual_description;
      // if (descriptionLevel === 'emoji') {
      //   description = vd.emoji_summary ? { emoji_summary: vd.emoji_summary } : undefined;
      // } else
      if (descriptionLevel === 'alt') {
        description = vd.alt_text ? { alt_text: vd.alt_text } : undefined;
      } else if (descriptionLevel === 'full') {
        description = {
          alt_text: vd.alt_text,
          long_description: vd.long_description,
        };
      }
    }

    return {
      id: hit._id,
      score: hit._score,
      title: source.title,
      artist: source.artist,
      date: source.date,
      medium: source.medium,
      classification: source.classification,
      department: source.department,
      image_url: includeImage ? imageData?.url : undefined,
      tags: source.tags,
      culture: source.culture,
      source_url: source.sourceUrl,
      description,
    };
  });
}

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

VISUAL DESCRIPTIONS:
Each artwork has an AI-generated visual description. Use "descriptionLevel" to include these in results:
- "none" (default): No descriptions (smallest response)
- "alt": Short alt-text description (~1 sentence)
- "full": Complete description with alt-text and detailed long description

RECOMMENDATION: For semantic/conceptual searches, consider using "alt" or "full" to understand
what each artwork depicts without needing to call get_artwork for each result. This is especially
useful when you don't already know the artworks and can't rely on titles alone.

TIPS:
- Call get_filter_options first to see valid department/classification/culture values
- Use filters to narrow results (e.g., artistName: "Van Gogh", yearStart: 1880, yearEnd: 1890)
- Use offset for pagination when has_more is true`,
      {
        query: z.string().min(1).describe('Search query text (e.g., "sunflowers", "portraits of women", "impressionist landscapes")'),
        filters: FiltersSchema,
        mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid').describe('Search mode: keyword (exact text), semantic (conceptual), or hybrid (both)'),
        // descriptionLevel enum also supports 'emoji' for compact emoji summaries (commented out)
        descriptionLevel: z.enum(['none', 'alt', 'full']).default('none').describe('Level of visual description to include: none, alt (short ~1 sentence), or full (detailed)'),
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return'),
        offset: z.number().int().min(0).max(200).default(0).describe('Offset for pagination'),
        includeImage: z.boolean().default(true).describe('Include image URLs in results'),
      },
      async ({ query, filters, mode, descriptionLevel, limit, offset, includeImage }) => {
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

        const paginatedHits = searchResults.hits.slice(offset, offset + limit);
        const hasMore = searchResults.total > offset + limit;
        const results = formatSearchResults(paginatedHits, includeImage, descriptionLevel);

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
AI-generated description, tags, similar artworks, and image URLs.

Use this after search_artworks to get full details on interesting results.`,
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

        const imageData: ArtworkImage | undefined =
          typeof artwork.image === 'string' ? { url: artwork.image } : artwork.image;

        const result = {
          id,
          title: artwork.title,
          titles: artwork.titles,
          artist: artwork.artist,
          artists: artwork.artists?.map((a: Artist) => ({
            id: a.constituentId,
            name: a.displayName,
            role: a.role,
            bio: a.displayBio,
            nationality: a.nationality,
            birth_year: a.beginDate,
            death_year: a.endDate,
          })),
          date: artwork.date,
          date_start: artwork.dateBegin,
          date_end: artwork.dateEnd,
          medium: artwork.medium,
          dimensions: artwork.dimensions,
          classification: artwork.classification,
          department: artwork.department,
          object_name: artwork.objectName,
          culture: artwork.culture,
          period: artwork.period,
          dynasty: artwork.dynasty,
          country: artwork.country,
          region: artwork.region,
          collection: artwork.collection,
          collection_id: artwork.collectionId,
          credit_line: artwork.creditLine,
          accession_year: artwork.accessionYear,
          is_public_domain: artwork.isPublicDomain,
          is_highlight: artwork.isHighlight,
          on_view: artwork.onView,
          gallery_number: artwork.galleryNumber,
          image: imageData ? {
            url: imageData.url,
            thumbnail_url: imageData.thumbnailUrl,
            width: imageData.width,
            height: imageData.height,
          } : undefined,
          description: artwork.visual_description ? {
            alt_text: artwork.visual_description.alt_text,
            long_description: artwork.visual_description.long_description,
            emoji_summary: artwork.visual_description.emoji_summary,
          } : undefined,
          tags: artwork.tags,
          similar_artworks: artwork.similar_artworks,
          source_url: artwork.sourceUrl,
        };

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
          // Use embedding search via findSimilarArtworks
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
        limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return'),
      },
      async ({ image, filters, limit }) => {
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

          const results = formatSearchResults(searchResults.hits, true);

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

Returns:
- departments: Museum departments (e.g., "European Paintings", "American Paintings")
- classifications: Artwork types (mostly "Paintings" in this collection)
- cultures: Cultural origins (e.g., "French", "Dutch", "American")
- tags: Subject tags (e.g., "Portraits", "Landscapes", "Women")
- date_range: Min/max years in the collection

IMPORTANT: Call this first to discover valid filter values before using search_artworks with filters.`,
      {},
      async () => {
        const options = await getFilterOptions();

        const result = {
          departments: options.departments,
          classifications: options.classifications,
          cultures: options.cultures,
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
