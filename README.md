# Met Museum Semantic Search

A Next.js application for searching the Metropolitan Museum of Art collection using state-of-the-art multimodal AI embeddings. Compare search results across different embedding models including Jina and Google Vertex AI.

## Features

- **Multi-model Semantic Search**: Compare results from different embedding models side-by-side
- **Keyword Search**: Traditional Elasticsearch text search
- **Hybrid Search**: Combine keyword and semantic search
- **Visual Search**: Search by image similarity using multimodal embeddings
- **Public Domain Only**: Respects copyright by only indexing public domain artworks

## Model Performance Notes

After testing with museum artwork, we found:

1. **JinaCLIP v2** performed exceptionally well for visual art search, providing highly relevant results for artwork similarity matching. We ultimately removed it from the active models because **Jina Embeddings v4** (2048 dims) performed just as well while also supporting combined text+image inputs, allowing us to leverage artwork metadata for even richer semantic search.

2. **Cohere Embed 4** did not produce results as relevant as other models for art-related queries. The implementation remains in `lib/embeddings/cohere.ts` for reference.

3. **Voyage Multimodal 3** had significant rate limiting issues on the free tier (3 requests/minute), making it extremely slow for generating embeddings at scale. Additionally, the search results were not as relevant as Jina models or Google Vertex AI for art-related queries. Further research with a paid account might yield different results. The implementation remains in `lib/embeddings/voyage.ts` for reference.

The current models (Jina Embeddings v4 and Google Vertex AI) provide excellent performance for visual art search, with Jina v4's multimodal fusion capability being particularly powerful for combining visual and textual understanding.

## Prerequisites

- Node.
- Docker (for Elasticsearch)
- Met Museum artwork images (in `data/met_artworks/`)
- API keys for embedding providers (Jina, Google Vertex AI)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/met-semantic-search-next.git
cd met-semantic-search-next
npm install
```

### 2. Download the Met Museum data

Download the Metropolitan Museum's open access CSV file:

```bash
# Create data directory
mkdir -p data

# Download the CSV (it's large, ~250MB)
curl -L https://github.com/metmuseum/openaccess/raw/master/MetObjects.csv -o data/MetObjects.csv
```

### 3. Add artwork images

Download the HuggingFace dataset:
```bash
# Install Python dependencies
python3 -m pip install -r requirements.txt

# Download filtered dataset (~102k images, ~5-10GB)
npm run download-huggingface
```


### 4. Set up environment variables

Create a `.env.local` file:

```env
# Embedding API Keys
JINA_API_KEY=your_jina_api_key
GOOGLE_CLOUD_API_KEY=your_google_api_key
GOOGLE_CLOUD_PROJECT_ID=your_project_id

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200
NEXT_PUBLIC_ELASTICSEARCH_URL=http://localhost:9200
```

### 5. Start Elasticsearch

```bash
docker-compose up -d
```

This starts Elasticsearch and Kibana locally.

### 6. Index the artworks

```bash
# First time setup - creates new index
npm run index-artworks --force --limit=100

# Subsequent runs - preserves existing data
npm run index-artworks
```

**Important**: 
- Without the `--force` flag, the script will:
  - Check if the index already exists
  - If it exists, skip index creation and preserve all existing data
  - NOT re-index any artworks - it simply exits
  - This is safe to run multiple times - it won't duplicate or overwrite data
- Only indexes public domain artworks from these 7 departments:
  - European Paintings (2,327 works)
  - Greek and Roman Art (29,877 works)
  - Egyptian Art (12,269 works)
  - Asian Art (31,295 works)
  - Islamic Art (13,226 works)
  - Medieval Art (6,920 works)
  - Ancient Near Eastern Art (6,190 works)

### 7. Generate embeddings

**Option A: File-based workflow (Recommended for production)**
```bash
# Generate embeddings to files (resumable, portable)
npm run generate-embeddings-to-file -- --model=jina_embeddings_v4
npm run generate-embeddings-to-file -- --model=google_vertex_multimodal
# ... repeat for other models

# Then index everything to Elasticsearch
npm run index-with-embeddings -- --force
```

**Option B: Direct to Elasticsearch (Simple for testing)**
```bash
npm run generate-embeddings
```

See [EMBEDDINGS_WORKFLOW.md](EMBEDDINGS_WORKFLOW.md) for details on the file-based approach.

### 8. Start the application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the application.

## Scripts

- `npm run download-huggingface` - Download filtered Met Museum images from HuggingFace
  - `--limit=N` - Download only N images (for testing)
- `npm run index-artworks` - Index artworks from CSV into Elasticsearch
  - `--force` - Force recreate the index (WARNING: deletes all existing data)
  - `--limit=N` - Only index N artworks (useful for testing)
- `npm run generate-embeddings` - Generate embeddings directly to Elasticsearch
- `npm run generate-embeddings-to-file` - Generate embeddings to files (resumable)
  - `--model=MODEL` - Which model to generate (required)
  - `--batch-size=N` - Embeddings per file (default: 1000)
  - `--resume` - Continue from last checkpoint
- `npm run index-with-embeddings` - Index artworks with pre-generated embeddings
  - `--force` - Force recreate index
  - `--limit=N` - Only index N artworks
- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm run start` - Start production server

## Data Pipeline

1. **MetObjects.csv** → Filtered for public domain → Matched with images → Indexed to Elasticsearch
2. **Elasticsearch documents** → Generate embeddings → Update documents with embeddings
3. **Search queries** → Multi-model search → Side-by-side results comparison

See [DATA_PIPELINE.md](DATA_PIPELINE.md) for detailed documentation.

## Architecture

- **Frontend**: Next.js 15 with TypeScript
- **UI Components**: Shadcn/ui with Tailwind CSS
- **Search Engine**: Elasticsearch 8.11
- **Images**: Pre-sized ~500px from HuggingFace dataset
- **Embedding Models**: 
  - **Jina Embeddings v4**: 2048 dims, multimodal text+image fusion
  - **Google Vertex AI**: 1408 dims, enterprise-grade multimodal


## License

This project is MIT licensed. The Metropolitan Museum of Art data is used under their open access policy for public domain works.