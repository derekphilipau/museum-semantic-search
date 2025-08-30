# File-Based Embeddings Workflow

This workflow separates embedding generation from Elasticsearch indexing, allowing you to:
- Generate embeddings once and reuse them
- Resume if interrupted
- Move embeddings between environments
- Avoid regenerating expensive embeddings

## Directory Structure

```
data/
├── images/huggingface/       # Source images
├── embeddings/               # Generated embeddings
│   ├── jina_clip_v2/
│   │   ├── batch_001.jsonl   # 1000 embeddings per file
│   │   ├── batch_002.jsonl
│   │   └── progress.json     # Tracks progress
│   ├── voyage_multimodal_3/
│   ├── cohere_embed_4/
│   └── google_vertex_multimodal/
└── MetObjects.csv
```

## Step 1: Generate Embeddings to Files

Generate embeddings for each model separately:

```bash
# Generate Jina CLIP v2 embeddings
npm run generate-embeddings-to-file -- --model=jina_clip_v2

# Generate Voyage embeddings  
npm run generate-embeddings-to-file -- --model=voyage_multimodal_3

# Generate Cohere embeddings
npm run generate-embeddings-to-file -- --model=cohere_embed_4

# Generate Google Vertex embeddings
npm run generate-embeddings-to-file -- --model=google_vertex_multimodal
```

Options:
- `--batch-size=N` - Embeddings per file (default: 1000)
- `--resume` - Continue from last checkpoint

### Resume if Interrupted

```bash
# Resume from where you left off
npm run generate-embeddings-to-file -- --model=jina_clip_v2 --resume
```

### Monitor Progress

Each model directory contains a `progress.json`:
```json
{
  "lastProcessedIndex": 5999,
  "totalProcessed": 6000,
  "totalSkipped": 0,
  "totalFailed": 0,
  "lastObjectId": 123456,
  "timestamp": "2024-01-20T10:30:00Z"
}
```

## Step 2: Index to Elasticsearch

Once embeddings are generated, load everything into Elasticsearch:

```bash
# Create new index and load data + embeddings
npm run index-with-embeddings -- --force

# Or update existing index
npm run index-with-embeddings
```

This script:
1. Loads all embeddings from `data/embeddings/`
2. Reads artwork metadata from CSV
3. Combines data with embeddings
4. Bulk indexes to Elasticsearch

## Moving Between Environments

### On Development Machine:
```bash
# 1. Generate embeddings
npm run generate-embeddings-to-file -- --model=jina_clip_v2

# 2. Compress embeddings
tar -czf embeddings.tar.gz data/embeddings/

# 3. Upload to cloud storage or transfer
```

### On Production Server:
```bash
# 1. Download and extract embeddings
tar -xzf embeddings.tar.gz

# 2. Index with embeddings
npm run index-with-embeddings -- --force
```

## Benefits

1. **Cost Savings**: Generate embeddings once, use many times
2. **Resumable**: Can stop and continue anytime
3. **Portable**: Easy to backup and move embeddings
4. **Debuggable**: Can inspect embedding files
5. **Parallel Processing**: Run different models simultaneously
6. **Version Control**: Can track embeddings in git-lfs if needed

## File Format

Each JSONL file contains records like:
```json
{
  "object_id": 12345,
  "embedding": [0.123, -0.456, ...],
  "timestamp": "2024-01-20T10:30:00Z",
  "model": "jina_clip_v2",
  "dimension": 1024
}
```

## Tips

- Generate cheaper models first (Jina) to test the pipeline
- Use `--batch-size=100` for testing
- Back up the `data/embeddings/` directory regularly
- You can delete and regenerate individual model directories
- Files are append-only, so resuming is safe