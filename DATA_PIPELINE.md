# Data Pipeline Documentation

## Overview

This document explains how the Met Museum artwork data flows from the original CSV source to the Elasticsearch index.

## Data Sources

1. **MetObjects.csv** - The source of truth from the Metropolitan Museum of Art
   - Contains metadata for the entire collection
   - Located at: `data/MetObjects.csv`
   - Includes both public domain and copyrighted works

2. **Image files** - JPG images of artworks from HuggingFace dataset
   - Location: `data/images/huggingface/*.jpg`
   - Pre-processed ~500px images (optimal for embeddings)
   - Downloaded from `miccull/met_museum` dataset
   - Filename format: `{objectId}.jpg` (e.g., `123.jpg`)

## Data Processing Pipeline

### Step 1: Index into Elasticsearch

```bash
npm run index-artworks [options]
```

This indexes artworks that have matching images in `data/images/huggingface/`.

### Step 2: Download Images from HuggingFace

```bash
npm run download-huggingface
```

Options:
- `--limit=N` - Download only N images (useful for testing)

This script (`scripts/download-huggingface-dataset.py`):
- Reads the Met CSV to identify artworks in selected departments
- Downloads the HuggingFace dataset (cached after first download)
- Filters and extracts only images that are:
  - Public domain
  - From the 7 selected departments
- Saves ~102,000 pre-sized images (~500px) to `data/images/huggingface/`
- Creates metadata.jsonl with image information

### Step 3: Generate Embeddings

```bash
npm run generate-embeddings
```

This script:
- Reads indexed artworks from Elasticsearch
- Generates embeddings for artwork images using multiple AI models
- Updates documents with embeddings
- Skips artworks that already have embeddings

## Safety Features

1. **Index Protection**: The indexing script will NOT delete existing data unless `--force` is specified
2. **Public Domain Only**: Only artworks marked as public domain are indexed
3. **Image Requirement**: Only artworks with matching image files are included
4. **Idempotent Embeddings**: Re-running embedding generation skips already processed artworks

## Quick Start

For a fresh setup:

```bash
# 1. Index with force flag (first time only)
npm run index-artworks --force --limit=100

# 2. Generate embeddings
npm run generate-embeddings

# 3. Start the application
npm run dev
```

For subsequent runs (preserving existing data):

```bash
# Just run without --force
npm run index-artworks

# This will skip if index exists
```

## Quick Start

```bash
# 1. Download images from HuggingFace
npm run download-huggingface

# 2. Index with force flag (first time only)
npm run index-artworks --force

# 3. Generate embeddings
npm run generate-embeddings

# 4. Start the application
npm run dev
```

## Data Schema

The processed artwork documents contain:
- `id`: Object ID from the museum
- `metadata`: Structured metadata (title, artist, department, etc.)
- `image`: Filename of the artwork image (null if no image yet)
- `searchableText`: Concatenated text for keyword search
- `boostedKeywords`: Important fields for search ranking
- `embeddings`: AI-generated embeddings for semantic search