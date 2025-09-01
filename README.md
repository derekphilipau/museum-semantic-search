# Museum Semantic Search

A Next.js application for searching museum collections using state-of-the-art multimodal AI embeddings. Currently configured for the MoMA collection. Compare search results across different embedding models including Jina and Google Vertex AI.

## Note

This project is largely LLM vibe-coded for the purpose of quickly prototyping and experimenting with different semantic search techniques.  It should not be taken as a good example of Next.js or proper Elasticsearch indexing or querying.

## Features

- **Multi-model Semantic Search**: Compare results from different embedding models side-by-side
- **Keyword Search**: Traditional Elasticsearch text search
- **Hybrid Search**: Combine keyword and semantic search
- **Visual Search**: Search by image similarity using multimodal embeddings
- **Public Domain Only**: Respects copyright by only indexing public domain artworks

## Model Performance Notes

After testing with museum artwork, we found:

1. **JinaCLIP v2** performed exceptionally well for visual art search, providing highly relevant results for artwork similarity matching. We ultimately removed it from the active models because **Jina Embeddings v4** (2048 dims) performed just as well with higher dimensional embeddings for more nuanced visual understanding.

2. **Cohere Embed 4** did not produce results as relevant as other models for art-related queries. The implementation remains in `lib/embeddings/cohere.ts` for reference.

3. **Voyage Multimodal 3** had significant rate limiting issues on the free tier (3 requests/minute), making it extremely slow for generating embeddings at scale. Additionally, the search results were not as relevant as Jina models or Google Vertex AI for art-related queries. Further research with a paid account might yield different results. The implementation remains in `lib/embeddings/voyage.ts` for reference.

4. **Text+Image Fusion Investigation**: We extensively tested multimodal embeddings that combine artwork metadata (title, artist, medium, etc.) with images. Testing revealed that both Jina v4 and Google Vertex produce nearly identical embeddings whether using image-only or image+text inputs - the image features dominate so heavily that text contributes negligibly to the final embedding (cosine similarity of 0.9999-1.0000). Due to this finding, we use image-only embeddings for multimodal models, as adding text provides no practical benefit for retrieval quality.

The current models (Jina Embeddings v4 and Google Vertex AI) provide excellent performance for visual art search using image-only embeddings.

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

Download the museum data:
- https://github.com/MuseumofModernArt/collection/
- https://github.com/metmuseum/openaccess

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

# Visual Description Generation
GOOGLE_GEMINI_API_KEY=your_gemini_api_key  # For Gemini 2.5 Flash descriptions

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

The system generates multimodal embeddings using both text metadata and artwork images for enhanced semantic understanding.

**Embedding Models:**
- **Jina Embeddings v3** (`jina-embeddings-v3`)
  - 1024 dimensions
  - Text-only embeddings optimized for text matching
  - Uses `task: "text-matching"` for better text retrieval
  - Model: `jina-embeddings-v3`

- **Jina Embeddings v4** (`jina-embeddings-v4`)
  - 2048 dimensions
  - Image-only embeddings for visual similarity search
  - Model: `jina-embeddings-v4`
  
- **Google Vertex AI Multimodal** (`multimodalembedding@001`)
  - 1408 dimensions  
  - Image-only embeddings for visual similarity search
  - Model: `multimodalembedding@001`

**Image Embeddings:**
Multimodal models process artwork images to create embeddings that capture visual features like composition, color, style, and subject matter. Despite supporting text+image inputs, our testing found that text contributes negligibly when combined with images (see Model Performance Notes above).

**Example embedding generation output:**

For image models (Jina v4, Google Vertex):
```
[62/100] Anabol(A): PACE CAR for the HUBRIS PILL by Matthew Barney
  Downloading image...
  Generating jina_embeddings_v4 embedding...
  ✓ Success (2048 dimensions)
```

For text-only models (Jina v3):
```
[62/100] Anabol(A): PACE CAR for the HUBRIS PILL by Matthew Barney
  Generating jina_embeddings_v3 embedding...
  Using text+image: "anabol(a): pace car for the hubris pill matthew ba..."
  Searchable text: "anabol(a): pace car for the hubris pill matthew barney 1991 internally lubricated plastic, teflon fa..."
  ✓ Success (1024 dimensions)
```

The searchable text includes all relevant metadata fields concatenated and normalized, providing rich context for the embedding models to understand both the visual and conceptual aspects of each artwork.

**Visual Descriptions with Gemini 2.5 Flash:**
We also generate bias-free visual descriptions using Google's Gemini 2.5 Flash model, following Cooper Hewitt accessibility guidelines:
- **Alt Text**: 15-word concise summary for accessibility
- **Long Description**: Detailed 100-500 word description focusing purely on visual elements
- **Zero Metadata Contamination**: No artist names, dates, or cultural attributions to avoid bias
- **Objective Description**: Only describes what is visually present, no interpretations

**Workflow (Recommended for production)**
```bash
# 1. Generate embeddings to files (resumable, portable)
npm run generate-embeddings -- --model=jina_embeddings_v3      # Text-only
npm run generate-embeddings -- --model=jina_embeddings_v4      # Image-only
npm run generate-embeddings -- --model=google_vertex_multimodal # Image-only

# 2. Generate visual descriptions with Gemini
npm run generate-descriptions -- --limit=100    # Start with 100 for testing
npm run generate-descriptions -- --resume        # Resume from last checkpoint

# 3. Index everything to Elasticsearch
npm run index-artworks -- --force

# 4. Update with visual descriptions
npm run update-descriptions
```

The file-based approach allows for resumable generation and easier data portability between environments.

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
- `npm run generate-embeddings` - Generate embeddings to files (resumable)
  - `--model=MODEL` - Which model to generate (required)
  - `--limit=N` - Only process N artworks
  - `--resume` - Continue from last checkpoint
  - `--batch-size=N` - Save progress every N artworks (default: 10)
- `npm run generate-descriptions` - Generate visual descriptions using Gemini 2.5 Flash
  - `--limit=N` - Only process N artworks
  - `--resume` - Continue from last checkpoint
  - `--batch-size=N` - Save progress every N artworks (default: 10)
- `npm run update-descriptions` - Update Elasticsearch with generated descriptions
  - `--limit=N` - Only update N artworks
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
  - **Jina Embeddings v3**: 1024 dims, text-only for precise text matching
  - **Jina Embeddings v4**: 2048 dims, image-only visual similarity search
  - **Google Vertex AI**: 1408 dims, image-only visual similarity search


## Future Improvements

Future enhancements could include native Elasticsearch integration for Jina AI embeddings and reranking models via the Open Inference API, eliminating the need for separate API calls. This would provide seamless embedding generation during indexing and built-in reranking capabilities for improved search relevance.

## License

This project is MIT licensed. Museum data is used according to each institution's open access policies.