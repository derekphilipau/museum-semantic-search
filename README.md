# Museum Semantic Search

A Next.js application for searching museum collections using state-of-the-art multimodal AI embeddings. Currently configured for the MoMA collection. Compare search results across different embedding models including Jina and Google Vertex AI.

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
- Museum artwork data (e.g., MoMA CSV in `data/moma/`)
- API keys for embedding providers (Jina, Google Vertex AI)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/museum-semantic-search-next.git
cd museum-semantic-search-next
npm install
```

### 2. Prepare museum data

Place your museum collection data in the appropriate directory. For MoMA:

```bash
# Create data directory
mkdir -p data

# For MoMA data:
# Place Artworks_50k.csv in data/moma/
# The file should contain artwork metadata with ImageURL field
```

### 3. Data preparation

For MoMA, the artwork images are referenced by URLs in the CSV file, so no separate image download is needed.


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

## Dataset Information

The system is designed to work with various museum collections. Currently configured for MoMA's collection of modern and contemporary art.

### MoMA Collection
- **Total artworks**: ~48,000+ in the indexed dataset
- **Coverage**: Modern and contemporary art from 1870s to present
- **Metadata**: Artist, date, medium, department, classification
- **Images**: Direct URLs to MoMA's image server

### Adding Other Collections

The system supports multiple museum collections through a parser architecture. To add a new collection:
1. Create a parser implementing the `CollectionParser` interface
2. Place data files in `data/[collection-name]/`
3. Run indexing with `--collection [collection-name]`
| Greek and Roman Art | 33,726 | 29,877 | 88.6% |
| Egyptian Art | 27,969 | 12,269 | 43.9% |
| Medieval Art | 7,142 | 6,920 | 96.9% |
| Ancient Near Eastern Art | 6,223 | 6,190 | 99.5% |

### Dataset Characteristics

1. **Current dataset size**: 46,848 indexable artworks
2. **Department focus**: 
   - Asian Art dominates with 66.8% of the dataset
   - Islamic Art provides 28.2% of the collection
   - European Paintings adds 5.0% with high-quality Western art
3. **Estimated embedding costs**:
   - At ~$0.02 per 1000 embeddings (typical pricing)
   - Current dataset: ~$0.94 per model
   - Total for both models: ~$1.88

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

The file-based approach allows for resumable generation and easier data portability.

### 8. Start the application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the application.

## Scripts

- `npm run index-artworks` - Index artworks from museum data
  - `--collection=NAME` - Specify collection to index (e.g., moma)
- `npm run index-artworks` - Index artworks into Elasticsearch
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

1. **Museum data (CSV/JSON)** → Parsed by collection adapter → Indexed to Elasticsearch
2. **Elasticsearch documents** → Generate embeddings → Update documents with embeddings
3. **Search queries** → Multi-model search → Side-by-side results comparison

See [DATA_PIPELINE.md](DATA_PIPELINE.md) for detailed documentation.

## Architecture

- **Frontend**: Next.js 15 with TypeScript
- **UI Components**: Shadcn/ui with Tailwind CSS
- **Search Engine**: Elasticsearch 8.11
- **Images**: Direct URLs from museum servers (MoMA) or local files
- **Embedding Models**: 
  - **Jina Embeddings v4**: 2048 dims, multimodal text+image fusion
  - **Google Vertex AI**: 1408 dims, enterprise-grade multimodal


## License

This project is MIT licensed. Museum data is used according to each institution's open access policies.