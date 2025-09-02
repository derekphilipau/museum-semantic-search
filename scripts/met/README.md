# Met Museum Data Pipeline

This directory contains scripts for processing Metropolitan Museum of Art data.

## Important Notes

1. **Image URLs**: The Met CSV does NOT contain direct image URLs. The `Link Resource` column only contains collection page URLs. Actual image URLs must be fetched from the Met API.

2. **Image Availability**: Not all artworks have images! Even public domain paintings with a `Link Resource` may have no `primaryImage` in the API response.

3. **API Cache**: To avoid hitting the Met API repeatedly, we use a cache file system.

4. **Image Sizes**: The Met API provides two image URLs:
   - `primaryImage`: Original resolution (HUGE - often 10-20MB+)
   - `primaryImageSmall`: Web-large version (optimized, typically 200-500KB)
   
   **We use `primaryImageSmall` (web-large) for all processing** to save bandwidth and improve performance.

## Pipeline Steps

### 1. Pre-fetch Image URLs (REQUIRED FIRST STEP)

```bash
npm run fetch-met-images
```

This creates `data/met/met_image_urls_cache.json` with all image URLs. This step is REQUIRED before running any other Met scripts.

- Takes ~10 minutes to fetch all 5,286 paintings
- Only fetches paintings that are public domain
- Caches results to avoid repeated API calls
- Can be resumed with `--resume` flag

### 2. Generate Visual Descriptions

```bash
# Resumes by default - safe to run multiple times
npm run generate-descriptions-met -- --limit=100

# Force restart (overwrites existing progress)
npm run generate-descriptions-met -- --force --limit=100
```

- Uses the image URL cache to fetch images
- Generates descriptions with Gemini 2.5 Flash
- Saves to `data/met/descriptions/gemini_2_5_flash/descriptions.jsonl`
- **Default behavior**: Resumes from last checkpoint

### 3. Generate Embeddings

```bash
# SigLIP 2 cross-modal embeddings (images only) - resumes by default
npm run generate-siglip2-embeddings-met -- --limit=100

# Jina v3 text embeddings (metadata + descriptions) - resumes by default
npm run generate-jina-embeddings-met -- --limit=100
```

### 4. Index to Elasticsearch

```bash
npm run index-artworks -- --collection met --force
```

## Expected Results

Based on our analysis:
- Total public domain paintings in CSV: 5,286
- Estimated paintings with actual images: ~3,000-3,500 (60-70%)
- The exact count will be shown after running `fetch-met-images`

## Troubleshooting

**"Met image cache not found" error**
- Run `npm run fetch-met-images` first
- This is required before any other Met processing

**Low image count**
- This is expected - many Met paintings don't have digitized images
- The cache will show exact counts

**API timeouts**
- The fetch script includes retry logic
- Use `--resume` to continue if interrupted