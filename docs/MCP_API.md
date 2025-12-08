# MCP API Documentation

The Museum Semantic Search MCP API provides a clean, agent-friendly interface for searching and retrieving artwork data from the Met Museum collection.

**Base URL:** `https://your-domain.com/api/mcp`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search` | POST | Search artworks by text query with filters |
| `/artwork/{id}` | GET | Get full details for a specific artwork |
| `/filters` | GET | Get available filter values and schema |
| `/similar/{id}` | GET/POST | Find artworks similar to a given artwork |
| `/image-search` | POST | Search by image using visual similarity |

---

## POST /search

Search the collection using text queries with optional filters.

### Request

```json
{
  "query": "sunflowers",
  "filters": {
    "artistName": "Van Gogh",
    "yearStart": 1880,
    "yearEnd": 1890,
    "classification": "Paintings",
    "department": "European Paintings",
    "tags": ["Still Life", "Flowers"],
    "culture": "Dutch",
    "onView": true,
    "isPublicDomain": true
  },
  "mode": "hybrid",
  "limit": 10,
  "detail": "standard"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query text |
| `filters` | object | No | `{}` | Structured filters (see Filter Schema) |
| `mode` | string | No | `"hybrid"` | Search mode: `"keyword"`, `"semantic"`, `"hybrid"`, or `"auto"` |
| `limit` | number | No | `10` | Number of results per page (1-50) |
| `offset` | number | No | `0` | Number of results to skip for pagination (0-200) |
| `detail` | string | No | `"standard"` | Detail level: `"minimal"`, `"standard"`, or `"full"` (see Detail Levels) |

### Detail Levels

| Level | Fields Included | When to Use |
|-------|-----------------|-------------|
| `minimal` | id, score, title, artist, date | Fast scanning, listing IDs |
| `standard` | + medium, classification, department, tags, culture, image_url, thumbnail_url, source_url, alt_text | General browsing, showing results to users |
| `full` | + titles, artists array, date_start, date_end, dimensions, object_name, period, dynasty, country, region, collection, collection_id, credit_line, accession_year, is_public_domain, is_highlight, on_view, gallery_number, full image object, description (with long_description, emoji_summary), similar_artworks | Semantic evaluation (e.g., verifying "three women and horses" using long_description), or when complete details needed inline |

### Response

```json
{
  "meta": {
    "query": "sunflowers",
    "mode": "hybrid",
    "total": 42,
    "returned": 10,
    "offset": 0,
    "limit": 10,
    "has_more": true,
    "filters_applied": {
      "artistName": "Van Gogh",
      "yearStart": 1880,
      "yearEnd": 1890
    },
    "processing_time_ms": 245
  },
  "results": [
    {
      "id": "met_436524",
      "score": 0.95,
      "title": "Sunflowers",
      "artist": "Vincent van Gogh",
      "date": "1887",
      "medium": "Oil on canvas",
      "classification": "Paintings",
      "department": "European Paintings",
      "image_url": "https://images.metmuseum.org/...",
      "thumbnail_url": "https://images.metmuseum.org/.../small/...",
      "tags": ["Still Life", "Flowers"],
      "culture": "Dutch",
      "source_url": "https://www.metmuseum.org/art/collection/search/436524"
    }
  ]
}
```

### Search Modes

| Mode | Description |
|------|-------------|
| `keyword` | Traditional text search using Elasticsearch BM25 |
| `semantic` | Vector similarity search using Jina text embeddings |
| `hybrid` | Combines keyword + semantic using RRF (Reciprocal Rank Fusion) |
| `auto` | Same as `hybrid` (default) |

---

## GET /artwork/{id}

Get complete details for a specific artwork.

### Request

```
GET /api/mcp/artwork/met_436524
```

### Response

```json
{
  "id": "met_436524",
  "title": "Sunflowers",
  "titles": ["Sunflowers", "Tournesols"],

  "artist": "Vincent van Gogh",
  "artists": [
    {
      "id": "12345",
      "name": "Vincent van Gogh",
      "role": "Artist",
      "bio": "Dutch, Zundert 1853–1890 Auvers-sur-Oise",
      "nationality": "Dutch",
      "birth_year": 1853,
      "death_year": 1890
    }
  ],

  "date": "1887",
  "date_start": 1887,
  "date_end": 1887,

  "medium": "Oil on canvas",
  "dimensions": "43.2 × 61 cm",

  "classification": "Paintings",
  "department": "European Paintings",
  "object_name": "Painting",

  "culture": "Dutch",
  "period": "Post-Impressionist",
  "country": "France",
  "region": "Europe",

  "collection": "met",
  "collection_id": "436524",
  "credit_line": "Rogers Fund, 1949",
  "accession_year": 1949,

  "is_public_domain": true,
  "is_highlight": true,
  "on_view": true,
  "gallery_number": "822",

  "image": {
    "url": "https://images.metmuseum.org/...",
    "thumbnail_url": "https://images.metmuseum.org/.../small/...",
    "width": 2000,
    "height": 1600
  },

  "description": {
    "alt_text": "A bouquet of sunflowers in a vase",
    "long_description": "This vibrant painting depicts...",
    "emoji_summary": "🌻🎨🖼️"
  },

  "tags": ["Still Life", "Flowers", "Sunflowers"],

  "similar_artworks": [
    {
      "id": "met_436525",
      "similarity_type": "style",
      "confidence": 0.85,
      "explanation": "Similar post-impressionist brushwork"
    }
  ],

  "source_url": "https://www.metmuseum.org/art/collection/search/436524"
}
```

---

## GET /filters

Get available filter values and schema information. Useful for building filter UIs or understanding valid filter values.

### Default Mode (No Search)

Returns the top filter values from each category with counts.

```
GET /api/mcp/filters
```

#### Response

```json
{
  "departments": [
    { "value": "European Paintings", "count": 500 },
    { "value": "American Art", "count": 300 }
  ],
  "classifications": [
    { "value": "Paintings", "count": 800 },
    { "value": "Drawings", "count": 200 }
  ],
  "cultures": [
    { "value": "French", "count": 150 },
    { "value": "Dutch", "count": 100 }
  ],
  "mediums": [
    { "value": "Oil on canvas", "count": 1500 },
    { "value": "Watercolor", "count": 200 }
  ],
  "tags": [
    { "value": "Portraits", "count": 250 },
    { "value": "Landscapes", "count": 200 }
  ],
  "date_range": {
    "min": 1400,
    "max": 2024
  },
  "schema": {
    "artistName": {
      "type": "string",
      "description": "Artist name (fuzzy matched)",
      "examples": ["Van Gogh", "Rembrandt", "Monet"]
    },
    "yearStart": {
      "type": "number",
      "description": "Start year for date range filter",
      "min": 1400,
      "max": 2024
    },
    "yearEnd": {
      "type": "number",
      "description": "End year for date range filter",
      "min": 1400,
      "max": 2024
    },
    "department": {
      "type": "string",
      "description": "Museum department (exact match)",
      "enum": ["European Paintings", "American Art", "..."]
    },
    "classification": {
      "type": "string",
      "description": "Artwork classification/type (exact match)",
      "enum": ["Paintings", "Drawings", "..."]
    },
    "culture": {
      "type": "string",
      "description": "Cultural origin (exact match)",
      "enum": ["French", "Dutch", "..."]
    },
    "medium": {
      "type": "string",
      "description": "Materials/technique (fuzzy matched)",
      "examples": ["Oil on canvas", "Watercolor", "Oil on wood", "..."]
    },
    "tags": {
      "type": "array",
      "description": "Tags/keywords (exact match, can specify multiple)",
      "items": ["Portraits", "Landscapes", "..."]
    },
    "onView": {
      "type": "boolean",
      "description": "Filter to works currently on display"
    },
    "isPublicDomain": {
      "type": "boolean",
      "description": "Filter to public domain works only"
    }
  }
}
```

### Search Mode

Search for specific filter values using case-insensitive matching. Useful when you need to find the exact value to use in a filter (e.g., finding "Japan" vs "probably Japan" vs "China or Japan").

```
GET /api/mcp/filters?search=japan
GET /api/mcp/filters?search=portrait&field=tags
GET /api/mcp/filters?search=french&field=cultures&limit=50
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `search` | string | Yes (for search mode) | - | Case-insensitive search string |
| `field` | string | No | all | Limit search to specific field: `departments`, `classifications`, `cultures`, `mediums`, `tags`, `countries`, `periods` |
| `limit` | number | No | `20` | Max results per field (1-100) |

#### Response (Search Mode)

```json
{
  "search_query": "japan",
  "field_filter": "all",
  "results": {
    "cultures": [
      { "value": "Japan", "count": 45 },
      { "value": "probably Japan", "count": 12 },
      { "value": "China or Japan", "count": 8 },
      { "value": "Japan (?)", "count": 3 }
    ],
    "countries": [
      { "value": "Japan", "count": 45 }
    ]
  }
}
```

#### Examples

```bash
# Find all filter values containing "portrait"
curl "http://localhost:3000/api/mcp/filters?search=portrait"

# Search only tags field
curl "http://localhost:3000/api/mcp/filters?search=portrait&field=tags"

# Find Japanese-related cultures with higher limit
curl "http://localhost:3000/api/mcp/filters?search=japan&field=cultures&limit=50"
```

---

## GET/POST /similar/{id}

Find artworks similar to a given artwork using various methods.

### Request (GET with query params)

```
GET /api/mcp/similar/met_436524?method=precomputed&limit=10
```

### Request (POST with body)

```json
{
  "method": "combined",
  "model": "jina_clip",
  "limit": 20,
  "includeImage": true
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `method` | string | No | `"precomputed"` | Similarity method (see below) |
| `model` | string | No | `"jina_clip"` | Embedding model for `embedding` method |
| `limit` | number | No | `10` | Number of results (1-50) |
| `includeImage` | boolean | No | `true` | Include image URLs |

### Similarity Methods

| Method | Description |
|--------|-------------|
| `precomputed` | Uses LLM-curated similar artworks (fastest, best quality) |
| `embedding` | KNN search using embedding vectors |
| `metadata` | Matches on artist, date, medium, classification |
| `combined` | Weighted combination of embedding + metadata signals |

### Response

```json
{
  "meta": {
    "source_artwork": {
      "id": "met_436524",
      "title": "Sunflowers",
      "artist": "Vincent van Gogh"
    },
    "method": "precomputed",
    "model": null,
    "total": 5,
    "returned": 5,
    "processing_time_ms": 45
  },
  "results": [
    {
      "id": "met_436525",
      "score": 0.85,
      "title": "Irises",
      "artist": "Vincent van Gogh",
      "date": "1890",
      "medium": "Oil on canvas",
      "classification": "Paintings",
      "image_url": "https://images.metmuseum.org/...",
      "thumbnail_url": "https://images.metmuseum.org/.../small/...",
      "similarity_type": "style",
      "similarity_explanation": "Similar post-impressionist brushwork and vibrant color palette"
    }
  ]
}
```

---

## POST /image-search

Search for visually similar artworks by uploading an image.

### Request

```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "mimeType": "image/jpeg",
  "filters": {
    "classification": "Paintings",
    "yearStart": 1800,
    "yearEnd": 1900
  },
  "limit": 10,
  "detail": "standard"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | string | Yes | - | Base64-encoded image (with or without data URL prefix) |
| `mimeType` | string | No | `"image/jpeg"` | MIME type (auto-detected from data URL) |
| `filters` | object | No | `{}` | Structured filters to narrow results |
| `limit` | number | No | `10` | Number of results (1-50) |
| `detail` | string | No | `"standard"` | Detail level: `"minimal"`, `"standard"`, or `"full"` |

### Response

```json
{
  "meta": {
    "method": "image_embedding",
    "model": "jina_clip",
    "total": 156,
    "returned": 10,
    "filters_applied": {
      "classification": "Paintings"
    },
    "processing_time_ms": 1250,
    "embedding_time_ms": 800
  },
  "results": [
    {
      "id": "met_436524",
      "score": 0.92,
      "title": "Sunflowers",
      "artist": "Vincent van Gogh",
      "date": "1887",
      "medium": "Oil on canvas",
      "classification": "Paintings",
      "department": "European Paintings",
      "image_url": "https://images.metmuseum.org/...",
      "thumbnail_url": "https://images.metmuseum.org/.../small/...",
      "tags": ["Still Life", "Flowers"],
      "culture": "Dutch",
      "source_url": "https://www.metmuseum.org/art/collection/search/436524"
    }
  ]
}
```

---

## Filter Schema

All search endpoints support the following filters:

| Filter | Type | Description | Match Type |
|--------|------|-------------|------------|
| `artistName` | string | Artist name | Fuzzy |
| `yearStart` | number | Start of date range | Range (gte) |
| `yearEnd` | number | End of date range | Range (lte) |
| `medium` | string | Materials/technique | Fuzzy |
| `classification` | string | Artwork type | Exact |
| `department` | string | Museum department | Exact |
| `tags` | string[] | Keywords/tags | Exact (AND) |
| `culture` | string | Cultural origin | Exact |
| `country` | string | Country of origin | Exact |
| `onView` | boolean | Currently displayed | Exact |
| `isPublicDomain` | boolean | Public domain status | Exact |

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (missing/invalid parameters) |
| 404 | Artwork not found |
| 500 | Server error |

---

## CORS

All endpoints support CORS with:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

---

## Rate Limiting

Currently no rate limiting is implemented. For production use, consider adding rate limiting at the infrastructure level.

---

## Examples

### Find Van Gogh paintings from the 1880s

```bash
curl -X POST https://your-domain.com/api/mcp/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "paintings",
    "filters": {
      "artistName": "Van Gogh",
      "yearStart": 1880,
      "yearEnd": 1889,
      "classification": "Paintings"
    },
    "limit": 10
  }'
```

### Get artwork details

```bash
curl https://your-domain.com/api/mcp/artwork/met_436524
```

### Find similar artworks

```bash
curl https://your-domain.com/api/mcp/similar/met_436524?method=combined&limit=20
```

### Search by image

```bash
curl -X POST https://your-domain.com/api/mcp/image-search \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "filters": { "classification": "Paintings" },
    "limit": 10
  }'
```

---

## Agent Integration Tips

1. **Use `/filters` first** to understand available filter values
2. **Start with `hybrid` mode** for best search quality
3. **Use `precomputed` similarity** when available (faster, higher quality)
4. **Include `filters_applied` in responses** to users for transparency
5. **Handle fallbacks** - semantic search falls back to keyword if embedding fails

---

## MCP Server

This app includes a built-in MCP (Model Context Protocol) server that exposes the search API as tools for AI agents.

### Endpoint

```
http://localhost:3000/api/mcp  (Streamable HTTP transport)
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_artworks` | Text search with semantic/hybrid modes, filters, pagination |
| `get_artwork` | Full artwork details by ID |
| `find_similar` | Find similar artworks (precomputed or embedding-based) |
| `search_by_image` | Visual similarity search with base64 image |
| `get_filter_options` | Get available filter values; supports search param to find specific values (e.g., "japan" → "Japan", "probably Japan") |

### Testing with MCP Inspector

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Launch the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector
   ```

3. Open the pre-filled URL shown in the terminal (includes auth token):
   ```
   http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=<token>
   ```

4. In the Inspector:
   - Set **Transport Type** to `Streamable HTTP`
   - Set **URL** to `http://localhost:3000/api/mcp`
   - Click **Connect**

5. You should see the 5 tools listed. Try calling `search_artworks` with `{"query": "sunflowers"}`.

### Testing with curl

```bash
# Initialize session
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'

# List tools
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Search for artworks
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_artworks","arguments":{"query":"impressionist landscapes","limit":5}}}'
```

### Connecting Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "museum-search": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

Restart Claude Desktop to connect.

### Connecting Claude Code

```bash
claude mcp add --transport http museum-search http://localhost:3000/api/mcp
```
