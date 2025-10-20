# Met Museum Data Processing Pipeline

This directory contains scripts for processing The Metropolitan Museum of Art's collection data.

## Pipeline Overview

The pipeline consists of 10 sequential steps:

1. **Create Dataset** (`1-create-paintings-dataset.ts`)
   - Filters Met CSV for paintings with images
   - Creates `MetPaintingsWithImages.csv`

2. **Generate Descriptions** (`2-generate-descriptions-met.ts`)
   - Uses Gemini 2.5 Flash to generate AI visual descriptions
   - Outputs: `descriptions.jsonl`

3. **Edit Descriptions** (`3-edit-descriptions-met.ts`)
   - Applies editorial review to ensure objectivity
   - Outputs: `edited_descriptions.jsonl`

4. **Generate Text Embeddings** (`generate-text-embeddings.ts`)
   - Uses Jina v3 text embeddings on metadata + descriptions
  - Outputs: `embeddings/jina_text/embeddings.jsonl`

5. **Generate Image Embeddings** (`generate-image-embeddings.ts`)
   - Uses Jina CLIP v2 embeddings for primary images
   - Outputs: `embeddings/jina_clip/embeddings.jsonl`
   - Install `sharp` (`npm install sharp`) so oversized images can be compressed before calling the Jina API

6. **Generate Similar Artworks** (`7-generate-similar-artworks-met.ts`)
   - Gathers candidates (metadata + embeddings), applies RRF fusion, and sends prompts to Gemini 2.5 Flash with bounded concurrency
   - Outputs: `similar_artworks.jsonl` (JSONL records containing curated similarities + evidence)

7. **Update Similarities** (`8-update-similarities-met.ts`)
   - Updates Elasticsearch with similarity data
   - Note: This step is now integrated into final indexing

8. **Generate UMAP Projections** (`generate-umap-projections.ts`)
   - Creates 2D/3D projections for visualization
   - Outputs: `projections/{embedding_type}/{projection_type}.jsonl`

9. **Index to Elasticsearch** (`10-index-artworks.ts`)
   - Final step: indexes all data including projections
   - Creates/updates the Elasticsearch index

## Running the Pipeline

### Full Pipeline
```bash
# Step 1: Create dataset
npm run 1-create-paintings-dataset

# Step 2-3: Generate and edit descriptions
npm run 2-generate-descriptions-met
npm run 3-edit-descriptions-met

# Step 4-5: Generate embeddings
npm run 4-generate-text-embeddings-met
npm run 5-generate-image-embeddings-met

# Step 6-7: Generate similarities
npm run 6-generate-similar-artworks-met -- --batch-size 6
npm run 7-update-similarities-met

> Tip: use `--limit` for smoke tests and `--force` to regenerate the JSONL from scratch. `--batch-size` controls parallel Gemini calls (default 6); the generator resumes automatically if the output file already exists.

# Step 8: Generate projections
npm run 9-generate-umap-projections-met

# Step 9: Index everything
npm run 10-index-artworks
```

### Quick Setup (from package.json)
```bash
npm run setup  # Shows all steps in order
```

## Key Features

- **Idempotent**: All scripts track processed IDs and skip existing work
- **Resumable**: Automatically resumes from last processed artwork
- **No data loss**: Never overwrites existing work without explicit flags
- **Concurrent processing**: Configurable parallel Gemini calls to respect rate limits

## File Structure

```
data/met/
├── MetObjects.csv                    # Original Met CSV
├── MetPaintingsWithImages.csv        # Filtered dataset
├── descriptions.jsonl                # AI descriptions
├── edited_descriptions.jsonl         # Edited descriptions
├── embeddings/
│   ├── jina_text/
│   │   └── embeddings.jsonl
│   └── jina_clip/
│       └── embeddings.jsonl
├── similar_artworks.jsonl           # Pre-computed similarities
├── projections/
│   ├── jina_text/
│   │   ├── standard_2d.jsonl
│   │   ├── tight_2d.jsonl
│   │   ├── loose_2d.jsonl
│   │   └── standard_3d.jsonl
│   └── jina_clip/
│       └── [projection files]
└── met_image_urls_cache.jsonl       # Image URL cache
```

## Common Issues

- **Gemini overloaded**: Try off-peak hours or reduce concurrency (`--batch-size`)
- **Missing projections**: Ensure embeddings exist before running step 9
- **Index errors**: Check Elasticsearch is running and accessible
