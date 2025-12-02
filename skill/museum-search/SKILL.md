---
name: museum-search
description: Search the Met Museum Open Access Paintings collection using semantic search, find similar artworks, and search by image. Use this when users ask about art, paintings, museum collections, or want to find artworks by description, visual similarity, or artist.
---

# Met Museum Paintings Semantic Search

Search ~2,300 paintings from the Met Museum Open Access collection using AI-powered semantic search.

**Keywords**: art search, museum, paintings, Met Museum, semantic search, artwork discovery, visual similarity, art history

## When to Use This Skill

Use this skill when users:
- Ask to find artworks by description ("find paintings of people on bridges")
- Want to explore museum collections
- Ask about specific artworks or artists at the Met
- Want to find visually similar artworks
- Upload an image to find matching paintings

## API Base URL

```
https://museum-semantic-search.vercel.app/api/mcp
```

## API Endpoints

### POST /search - Search Artworks

Search the collection using text queries with optional filters.

```bash
curl -X POST https://museum-semantic-search.vercel.app/api/mcp/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "person with a dog",
    "mode": "semantic",
    "limit": 10
  }'
```

**Request body:**
```json
{
  "query": "string (required)",
  "mode": "semantic | hybrid | keyword",
  "filters": {
    "artistName": "string (fuzzy matched)",
    "yearStart": 1800,
    "yearEnd": 1900,
    "department": "string (exact match)",
    "culture": "string (exact match)",
    "classification": "string (exact match)",
    "tags": ["string (exact match)"],
    "medium": "string (fuzzy matched)",
    "country": "string (exact match)",
    "onView": true,
    "isPublicDomain": true
  },
  "limit": 10,
  "offset": 0,
  "includeImage": true,
  "includeDescription": false
}
```

**Mode selection:**
- **"semantic"** (recommended): For descriptive queries like "lonely figure in nature", "woman looking in mirror", "stormy seascape"
- **"hybrid"**: When query includes terms likely in titles/metadata like "Madonna and child", "self portrait"
- **"keyword"**: For exact matches like artist names or specific titles

**Response:**
```json
{
  "meta": {
    "query": "person with a dog",
    "mode": "semantic",
    "total": 150,
    "returned": 10,
    "offset": 0,
    "limit": 10,
    "has_more": true,
    "filters_applied": {},
    "processing_time_ms": 234
  },
  "results": [
    {
      "id": "met_436524",
      "score": 0.85,
      "title": "...",
      "artist": "...",
      "date": "...",
      "medium": "...",
      "classification": "Paintings",
      "department": "European Paintings",
      "image_url": "...",
      "thumbnail_url": "...",
      "tags": ["Dogs", "Portraits"],
      "culture": "French",
      "source_url": "https://www.metmuseum.org/art/collection/search/436524"
    }
  ]
}
```

### GET /artwork/{id} - Get Artwork Details

Get complete details for a specific artwork.

```bash
curl https://museum-semantic-search.vercel.app/api/mcp/artwork/met_436524
```

**Response includes:**
- Basic info: title, titles (alternate), artist, artists (with roles, bio, dates)
- Dates: date, date_start, date_end
- Physical: medium, dimensions
- Classification: classification, department, object_name
- Context: culture, period, dynasty, country, region
- Collection: collection, collection_id, credit_line, accession_year
- Status: is_public_domain, is_highlight, on_view, gallery_number
- Image: url, thumbnail_url, width, height
- AI description: alt_text, long_description, emoji_summary
- Tags: array of keywords
- Similar artworks: id, similarity_type, confidence, explanation
- Links: source_url (Met Museum page)

### GET /similar/{id} - Find Similar Artworks

Find artworks similar to a given artwork using different methods.

```bash
# Precomputed (LLM-curated, recommended - includes explanations)
curl "https://museum-semantic-search.vercel.app/api/mcp/similar/met_436524?method=precomputed&limit=10"

# Embedding-based visual similarity (CLIP)
curl "https://museum-semantic-search.vercel.app/api/mcp/similar/met_436524?method=embedding&model=jina_clip&limit=10"

# Embedding-based conceptual similarity (text)
curl "https://museum-semantic-search.vercel.app/api/mcp/similar/met_436524?method=embedding&model=jina_text&limit=10"

# Metadata-based (same artist, period, culture, etc.)
curl "https://museum-semantic-search.vercel.app/api/mcp/similar/met_436524?method=metadata&limit=10"

# Combined (fuses metadata + text + image embeddings)
curl "https://museum-semantic-search.vercel.app/api/mcp/similar/met_436524?method=combined&limit=10"
```

**Query parameters:**
- `method`: "precomputed" (default), "embedding", "metadata", or "combined"
- `model`: "jina_clip" (visual) or "jina_text" (conceptual) - only for embedding method
- `limit`: 1-50 (default 10)
- `includeImage`: true/false (default true)

**Response:**
```json
{
  "meta": {
    "source_artwork": {
      "id": "met_436524",
      "title": "...",
      "artist": "..."
    },
    "method": "precomputed",
    "model": null,
    "total": 10,
    "returned": 10,
    "processing_time_ms": 45
  },
  "results": [
    {
      "id": "met_437234",
      "score": 0.92,
      "title": "...",
      "artist": "...",
      "similarity_type": "compositional",
      "similarity_explanation": "Both feature a central figure with a dog..."
    }
  ]
}
```

### POST /image-search - Search by Image

Find visually similar artworks by uploading an image.

```bash
curl -X POST https://museum-semantic-search.vercel.app/api/mcp/image-search \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQ...",
    "limit": 10
  }'
```

**Request body:**
```json
{
  "image": "base64-encoded image (with or without data URL prefix)",
  "mimeType": "image/jpeg",
  "filters": { },
  "limit": 10,
  "includeImage": true
}
```

**Response:** Same format as /search but includes `embedding_time_ms` in meta.

### GET /filters - Get Filter Options

Get available filter values for the collection.

```bash
curl https://museum-semantic-search.vercel.app/api/mcp/filters
```

**Response:**
```json
{
  "departments": [{ "value": "European Paintings", "count": 1500 }, ...],
  "classifications": [{ "value": "Paintings", "count": 2300 }, ...],
  "cultures": [{ "value": "French", "count": 450 }, ...],
  "tags": [{ "value": "Portraits", "count": 800 }, ...],
  "date_range": { "min": 1250, "max": 1950 },
  "schema": {
    "artistName": { "type": "string", "description": "...", "examples": [...] },
    "yearStart": { "type": "number", "description": "...", "min": 1250, "max": 1950 },
    ...
  }
}
```

## Workflow

### Step 1: Discover the Collection
Call `GET /filters` first to see available departments, cultures, tags, and date ranges.

### Step 2: Search
Use `POST /search` with appropriate mode based on query type.

### Step 3: Get Details
Call `GET /artwork/{id}` on interesting results for full metadata and AI descriptions.

### Step 4: Explore
Use `GET /similar/{id}` to discover related works.

## Example Queries

| Query | Recommended Mode | Why |
|-------|------------------|-----|
| "person with a dog" | semantic | Descriptive, not in titles |
| "woman looking in mirror" | semantic | Conceptual description |
| "stormy seascape" | semantic | Mood/atmosphere based |
| "Madonna and child" | hybrid | Common in artwork titles |
| "Rembrandt" | keyword | Exact artist name |
| "European Paintings before 1800" | keyword + filters | Use yearEnd filter |

## Tips

- The collection is primarily European and American paintings from the Met Museum
- AI-generated descriptions enable finding artworks by what's depicted, not just metadata
- Use `source_url` to link users to the official Met Museum page
- Pagination: when `has_more` is true, increase `offset` to get more results
- For similar artworks: "precomputed" gives the best quality with explanations; "embedding" is faster
- No authentication required - the API is publicly accessible
