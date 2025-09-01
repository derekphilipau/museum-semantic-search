# Museum Search - Data Processing Scripts

These scripts handle the data pipeline for the museum semantic search application.

## Prerequisites

1. Elasticsearch running on `http://localhost:9200`
2. Museum data in appropriate directory (e.g., `data/moma/` for MoMA)
3. API keys configured in `.env.local`:
   ```
   JINA_API_KEY=your_key
   GOOGLE_GEMINI_API_KEY=your_key  # For visual descriptions
   MODAL_EMBEDDING_API_URL=your_modal_url  # For SigLIP 2
   ```

## Data Pipeline Overview

```
CSV File → Generate Visual Descriptions → Generate Embeddings → Index to Elasticsearch
```

## Scripts

### 1. Generate Visual Descriptions (`generate-descriptions-to-file-moma.ts`)

Generates AI visual descriptions using Gemini 2.5 Flash for accessibility and enhanced search.

```bash
# Generate descriptions for testing
npm run generate-descriptions -- --limit=100

# Resume from checkpoint
npm run generate-descriptions -- --resume
```

**Output:** `data/descriptions/descriptions.jsonl`

### 2. Generate SigLIP 2 Embeddings (`generate_siglip2_embeddings.py`)

Generates cross-modal embeddings for text-to-image search.

```bash
# Install dependencies (one-time)
npm run setup-siglip2

# Generate embeddings
npm run generate-siglip2-embeddings -- --limit=100

# Resume from checkpoint
npm run generate-siglip2-embeddings -- --resume
```

**Output:** `data/embeddings/siglip2/embeddings.jsonl`

### 3. Generate Jina v3 Embeddings (`generate_jina_v3_embeddings.py`)

Generates advanced text embeddings combining metadata with visual descriptions.

```bash
# Generate embeddings
npm run generate-jina-embeddings -- --limit=100

# Resume from checkpoint
npm run generate-jina-embeddings -- --resume
```

**Output:** `data/embeddings/jina_v3/embeddings.jsonl`

### 4. Index Artworks (`index-artworks-with-embeddings.ts`)

Creates the Elasticsearch index and populates it with artworks, embeddings, and descriptions.

```bash
# Index all artworks with embeddings
npm run index-artworks

# Force recreate index (WARNING: deletes existing data)
npm run index-artworks -- --force

# Index limited number for testing
npm run index-artworks -- --limit=100
```

## Complete Workflow

```bash
# 1. Generate visual descriptions
npm run generate-descriptions -- --limit=100

# 2. Generate embeddings
npm run generate-siglip2-embeddings -- --limit=100
npm run generate-jina-embeddings -- --limit=100

# 3. Index everything
npm run index-artworks -- --force
```

## File Structure

```
data/
├── moma/
│   └── Artworks_50k.csv          # Source data
├── descriptions/
│   ├── descriptions.jsonl        # AI visual descriptions
│   └── progress.json             # Resume state
└── embeddings/
    ├── siglip2/
    │   ├── embeddings.jsonl      # Cross-modal embeddings
    │   └── progress.json         # Resume state
    └── jina_v3/
        ├── embeddings.jsonl      # Text embeddings
        └── progress.json         # Resume state
```

## Notes

- All scripts support resume functionality if interrupted
- Progress is saved periodically (configurable batch size)
- Failed items are logged but don't stop the process
- The indexing script loads all data from files (no ES dependencies during generation)

## Troubleshooting

**"File not found" errors:**
- Ensure embedding files exist before indexing
- Check file paths match expected structure

**Out of memory:**
- Reduce batch size in Python scripts with `--batch-size=8`
- For indexing, process fewer artworks at once

**Modal deployment issues:**
- Deploy SigLIP 2 to Modal first: `cd modal && modal deploy embedding_api.py`
- Set `MODAL_EMBEDDING_API_URL` in `.env.local`