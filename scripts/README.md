# Museum Search - Data Processing Scripts

These TypeScript scripts handle the data pipeline for the museum semantic search application.

## Prerequisites

1. Elasticsearch running on `http://localhost:9200`
2. Museum data in appropriate directory (e.g., `../data/moma/` for MoMA)
3. API keys configured in `.env.local`:
   ```
   JINA_API_KEY=your_key
   VOYAGE_API_KEY=your_key
   COHERE_API_KEY=your_key
   ```

## Scripts

### 1. Index Artworks (`index-artworks.ts`)

Creates the Elasticsearch index and populates it with artwork metadata.

```bash
# Index all artworks
npm run index-artworks

# Index limited number for testing
npm run index-artworks -- --limit=10
```

**What it does:**
- Creates `artworks_semantic` index with proper mappings
- Processes museum data using collection-specific parsers
- Extracts searchable text and keywords
- Sets up vector fields for embeddings

### 2. Generate Embeddings (`generate-embeddings.ts`)

Generates image embeddings using various AI models.

```bash
# Generate embeddings with default models
npm run generate-embeddings

# Generate for specific models
npm run generate-embeddings -- --models=jina_clip_v2,voyage_multimodal_3

# Limit to first 10 artworks
npm run generate-embeddings -- --limit=10

# Force regenerate existing embeddings
npm run generate-embeddings -- --no-skip-existing
```

**Supported models:**
- `jina_clip_v2` - JinaCLIP v2 (1024 dims) - Best for visual art
- `voyage_multimodal_3` - Voyage Multimodal-3 (1024 dims) - Supports interleaved text+image
- `cohere_embed_4` - Cohere Embed 4 (1536 dims) - For documents
- `google_vertex_multimodal` - Google Vertex (1408 dims) - Requires OAuth setup

**Rate limits:**
- Voyage: 3 requests per minute (automatic rate limiting)
- Other APIs: Check provider documentation

### 3. Combined Setup

Run both scripts in sequence:

```bash
npm run setup
```

## Workflow

1. **Initial setup:**
   ```bash
   npm run setup -- --limit=10  # Test with 10 artworks
   ```

2. **Full dataset:**
   ```bash
   npm run index-artworks
   npm run generate-embeddings -- --models=jina_clip_v2,voyage_multimodal_3
   ```

3. **Add new model embeddings:**
   ```bash
   npm run generate-embeddings -- --models=cohere_embed_4
   ```

## Notes

- Image embeddings are generated from actual artwork images using provider APIs
- The script respects rate limits automatically
- Failed embeddings are logged but don't stop the process
- Progress is saved after each artwork (can resume if interrupted)
- Cohere uses field name `cohere_embed_4_v2` due to dimension change

## Troubleshooting

**"Image not found" errors:**
- Ensure data exists in appropriate directory (e.g., `../data/moma/`)
- Image filenames should match the pattern: `{objectId}_{artistName}.jpg`

**API errors:**
- Check API keys in `.env.local`
- Verify rate limits haven't been exceeded
- Some models may have size limits for images

**Elasticsearch errors:**
- Ensure Elasticsearch is running: `curl http://localhost:9200`
- Check index exists: `curl http://localhost:9200/artworks_semantic`