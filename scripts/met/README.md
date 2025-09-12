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

4. **Generate Text Embeddings** (`4-generate-jina-text-embeddings-met.py`)
   - Creates Jina v3 embeddings from text + descriptions
   - Outputs: `jina_v3_embeddings.jsonl`

5. **Generate Image Embeddings** (`5-generate-siglip2-image-embeddings-met.py`)
   - Creates SigLIP2 cross-modal embeddings
   - Outputs: `siglip2_embeddings.jsonl`

6. **Generate Similar Artworks** (`7-generate-similar-artworks-met.ts`)
   - Pre-computes artwork similarities using LLM filtering
   - Outputs: `similar_artworks.jsonl`

7. **Update Similarities** (`8-update-similarities-met.ts`)
   - Updates Elasticsearch with similarity data
   - Note: This step is now integrated into final indexing

8. **Generate UMAP Projections** (`9-generate-umap-projections-met.py`)
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
npm run 4-generate-jina-embeddings-met
npm run 5-generate-siglip2-embeddings-met

# Step 6-7: Generate similarities
npm run 6-generate-similar-artworks-met
npm run 7-update-similarities-met

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
- **Batch processing**: Configurable batch sizes for API rate limits

## File Structure

```
data/met/
├── MetObjects.csv                    # Original Met CSV
├── MetPaintingsWithImages.csv        # Filtered dataset
├── descriptions.jsonl                # AI descriptions
├── edited_descriptions.jsonl         # Edited descriptions
├── jina_v3_embeddings.jsonl         # Text embeddings
├── siglip2_embeddings.jsonl         # Image embeddings
├── similar_artworks.jsonl           # Pre-computed similarities
├── projections/
│   ├── jina_v3/
│   │   ├── standard_2d.jsonl
│   │   ├── tight_2d.jsonl
│   │   ├── loose_2d.jsonl
│   │   └── standard_3d.jsonl
│   └── siglip2/
│       └── [projection files]
└── met_image_urls_cache.jsonl       # Image URL cache
```

## Common Issues

- **Gemini overloaded**: Try off-peak hours or reduce batch size
- **Missing projections**: Ensure embeddings exist before running step 9
- **Index errors**: Check Elasticsearch is running and accessible