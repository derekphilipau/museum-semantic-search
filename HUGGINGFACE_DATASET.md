# Using the HuggingFace Met Museum Dataset

This guide explains how to use the pre-processed Met Museum dataset from HuggingFace instead of downloading images from the Met API.

## Why Use the HuggingFace Dataset?

- **Fast**: Download 23.6GB in ~1-2 hours vs 28+ hours from Met API
- **Pre-processed**: ~500px images perfect for embeddings (especially JinaCLIP v2)
- **Complete**: 244,000 images with all metadata preserved
- **Reliable**: No API rate limits or failures

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Download and extract the dataset:

```bash
# Download images (department filtering not available - see note below)
npm run download-huggingface

# Or test with a small subset first
npm run download-huggingface -- --limit=100
```

## What This Does

The script will:
1. Read the Met CSV file to identify artworks in your selected departments
2. Download the dataset from HuggingFace (cached after first download)
3. Extract ONLY images from your 7 selected departments to `data/images/huggingface/`
4. Save metadata to `data/images/huggingface/metadata.jsonl`

**How it works**: Since the HuggingFace dataset has corrupted department information, the script cross-references with the Met CSV file to filter by department before extracting images.

## Expected Output

With department filtering:
- ~102,000 images (only from your 7 departments)
- ~5-6GB total size
- Average image size: ~500×500px, ~50KB

The script processes all 244k items but only extracts the ~102k that match your departments.

## Next Steps

After downloading:

1. Update the indexing script to use HuggingFace images:
   ```bash
   npm run index-artworks -- --source=huggingface
   ```

2. Generate embeddings:
   ```bash
   npm run generate-embeddings
   ```

## Dataset Structure

Each image is saved as `{objectID}.jpg` with metadata including:
- title
- artist (artistDisplayName)
- department
- culture
- period
- date (objectDate)
- medium
- dimensions
- tags
- width/height
- is_public_domain

## Notes

- First download will take time as it downloads the full 23.6GB dataset
- Subsequent runs use the cached dataset (stored in `~/.cache/huggingface/`)
- The dataset is already filtered for public domain works
- Images are web-optimized but high quality for embeddings