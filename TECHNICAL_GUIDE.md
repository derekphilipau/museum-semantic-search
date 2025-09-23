# Installation Guide

This prototype was developed quickly and is not production-ready. 

## Prerequisites

- Node.js 18+ 
- Docker (for Elasticsearch)
- Python 3.8+ (for local embedding generation scripts)
- Modal account (for serverless GPU inference) - https://modal.com
- Museum artwork data (e.g., Met CSV in `data/met/`)
- API keys:
  - Google Gemini API key (for visual descriptions)
  - Jina API key (optional fallback for text embeddings)

## Installation Steps

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/museum-semantic-search.git
cd museum-semantic-search
npm install
```

### 2. Prepare museum data

Download the museum data:

- https://github.com/metmuseum/openaccess

Place your museum collection data in the appropriate directory. For Met:

```bash
# Create data directory
mkdir -p data/met

# For Met data:
# Place the Met CSV file in data/met/MetObjects.csv
```

### 3. Data preparation

For Met, create a new CSV that filters artworks and gets image URLs:

```bash
npm run 1-create-paintings-dataset -- --limit=1000  # Test with 1000 (resumes by default)
npm run 1-create-paintings-dataset                     # Process all (resumes by default) 
```
This creates `data/met/MetPaintingsWithImages.csv` with image URLs.

### 4. Set up environment variables

Create a `.env.local` file:

```env
# Visual Description Generation
GOOGLE_GEMINI_API_KEY=your_gemini_api_key  # For Gemini 2.5 Flash descriptions

# Modal Unified Embeddings API - Returns both SigLIP 2 and Jina v3 in one call
MODAL_EMBEDDING_URL=https://your-username--museum-embeddings-embed-text.modal.run

# Elasticsearch Configuration
# Option 1: Local Elasticsearch (default)
ELASTICSEARCH_URL=http://localhost:9200

# Option 2: Elastic Cloud - use either Cloud ID or URL
# ELASTICSEARCH_CLOUD_ID=your-deployment:base64string
# ELASTICSEARCH_URL=https://your-deployment.es.elastic.co:9243
# ELASTICSEARCH_API_KEY=your-api-key

# Index name (optional, defaults to 'artworks_semantic')
# ELASTICSEARCH_INDEX=artworks_semantic

# Vercel KV (optional) - For caching embeddings
# Automatically set when you connect Vercel KV to your project
# KV_KV_REST_API_URL=https://...
# KV_KV_REST_API_TOKEN=...
```

### 5. Deploy Modal Embeddings API

The project uses Modal for serverless GPU inference to generate embeddings efficiently:

```bash
# Install Modal CLI
pip install modal

# Authenticate with Modal
modal setup

# Deploy the unified embeddings API
cd modal
modal deploy embedding_api.py
```

After deployment, Modal will provide your endpoint URL. Update your `.env.local`:
```env
MODAL_EMBEDDING_URL=https://your-username--museum-embeddings-embed-text.modal.run
```

**Modal API Features:**
- Single endpoint returns both SigLIP 2 and Jina v3 embeddings
- GPU-accelerated inference (T4 GPU)
- Auto-scaling based on load
- Persistent model loading (no cold starts between requests)
- ~$0.000006-0.000011 per request

See `modal/README.md` for detailed deployment instructions.

### 6. Set up Elasticsearch

#### Option A: Local Elasticsearch (Development)

```bash
docker-compose up -d
```

This starts Elasticsearch and Kibana locally on ports 9200 and 5601.

#### Option B: Elastic Cloud (Production)

1. Create an Elastic Cloud deployment at https://cloud.elastic.co
2. Get your Cloud ID and create an API key
3. Update `.env.local`:

```env
ELASTICSEARCH_CLOUD_ID=your-deployment:base64string
ELASTICSEARCH_API_KEY=your-api-key
```

The client will automatically detect and use cloud credentials when available.

### 7. Generate UMAP projections for visualization

Generate 2D and 3D projections of embeddings for the explore/visualize page:

```bash
# Generate projections for visualization
npm run 9-generate-umap-projections-met -- --limit 100  # Test with 100
npm run 9-generate-umap-projections-met                  # Process all
```

This creates dimensionality-reduced projections for interactive visualization of the embedding space.

### 8. Index the artworks

```bash
# First time setup - creates new index
npm run 10-index-artworks -- --force --limit 100

# Subsequent runs - preserves existing data
npm run 10-index-artworks
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

### 9. Generate embeddings

The system generates multimodal embeddings using both text metadata and artwork images for enhanced semantic understanding.

**Embedding Models:**
- **Jina v3** (`jina-embeddings-v3`)
  - 768 dimensions
  - Advanced text embeddings combining artwork metadata with AI-generated visual descriptions
  - Task-specific embeddings: "retrieval.passage" for indexing, "retrieval.query" for search
  - Only generated for artworks with visual descriptions
  
- **SigLIP 2** (`google/siglip2-base-patch16-224`)
  - 768 dimensions
  - True cross-modal embeddings - text and image in shared space
  - Improved semantic understanding and localization vs original SigLIP
  - Enables natural language image search ("cat on a chair", "stormy seascape")
  - Image embeddings stored in database, text queries processed at search time
  - Deployed via Modal for serverless GPU inference


**Example embedding generation output:**

For SigLIP 2 (cross-modal):
```
[62/100] Anabol(A): PACE CAR for the HUBRIS PILL by Matthew Barney
  Downloading image...
  Generating image embedding...
  ✓ Success (768 dimensions)
```

For Jina v3 (text):
```
[62/100] Anabol(A): PACE CAR for the HUBRIS PILL by Matthew Barney
  Creating text for embedding...
  Combined text: "Title: Anabol(A): PACE CAR for the HUBRIS PILL. Artist: Matthew Barney. Visual description: A glossy, translucent plastic sculpture..."
  ✓ Success (768 dimensions)
```

**Visual Descriptions with Gemini 2.5 Flash:**
We use a two-pass system to generate high-quality, bias-free visual descriptions following Cooper Hewitt accessibility guidelines:

**Pass 1 - Generation:**
- **Alt Text**: 10-20 word concise summary for accessibility
- **Long Description**: Detailed 100-300 word description focusing purely on visual elements  
- **Emoji Summary**: 2-8 emojis representing main visual elements
- **Objective Description**: Only describes what is visually present, no interpretations

**Pass 2 - Editorial Review:**
- Ensures complete objectivity without cultural assumptions
- Standardizes alt text to approximately 15 words
- Removes any metadata references (artist names, dates, etc.)
- Refines emoji selection for clarity and accuracy
- Allows qualified uncertainty ("possibly", "appears to be") for ambiguous visual elements

**Workflow (Recommended for production)**
```bash
# 1. Generate visual descriptions with Gemini (required for text embeddings)
npm run 2-generate-descriptions-met -- --limit=100          # Test with 100 (resumes by default)
npm run 2-generate-descriptions-met                         # Process all (resumes by default)
npm run 2-generate-descriptions-met -- --force --limit=100  # Start fresh (overwrites)

# 2. Edit visual descriptions for consistency and quality (optional but recommended)
npm run 3-edit-descriptions-met -- --limit=100     # Edit first 100 descriptions
npm run 3-edit-descriptions-met                     # Edit all descriptions
# Note: By default, ALL descriptions are edited. Use --skip-clean to only edit problematic ones

# 3. Generate SigLIP 2 cross-modal embeddings
# First install Python dependencies (one-time setup)
npm run setup-siglip2

# Then generate embeddings (runs locally on your Mac)
npm run 5-generate-siglip2-embeddings-met -- --limit 100    # Test with 100 (resumes by default)
npm run 5-generate-siglip2-embeddings-met                   # Process all (resumes by default)

# 4. Generate Jina v3 text embeddings (combines metadata + visual descriptions)
npm run 4-generate-jina-embeddings-met -- --limit 100      # Test with 100 (resumes by default)
npm run 4-generate-jina-embeddings-met                     # Process all (resumes by default)

# 5. Generate AI-curated similar artworks (optional but recommended)
npm run 6-generate-similar-artworks-met -- --limit 100  # Test with 100
npm run 6-generate-similar-artworks-met                  # Process all

# 6. Update Elasticsearch with similar artwork data
npm run 7-update-similarities-met -- --limit 100        # Update 100
npm run 7-update-similarities-met                        # Update all

# 7. Generate UMAP projections for visualization
npm run 9-generate-umap-projections-met -- --limit 100  # Test with 100
npm run 9-generate-umap-projections-met                  # Process all

# 8. Index everything to Elasticsearch (includes embeddings, descriptions, and projections)
npm run 10-index-artworks -- --force
```

**Quality Control**: Use `npm run compare-met-coverage` periodically to ensure all eligible artworks have been processed. The script identifies paintings from MetObjects.csv that are missing descriptions, helping maintain complete coverage.

**Note**: The Modal deployment (step 5 above) handles real-time query embedding generation. The scripts above generate embeddings for the artwork collection to be stored in Elasticsearch.

The file-based approach allows for resumable generation and easier data portability between environments.

### 10. Start the application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the application.

## Scripts

All Met scripts are numbered to indicate the recommended execution order:

- `npm run 1-create-paintings-dataset` - Create filtered CSV with Met paintings that have images
  - `--limit=N` - Only process first N artworks from Met CSV
  - `--force` - Start fresh instead of resuming (default: resume)
- `npm run 2-generate-descriptions-met` - Generate visual descriptions using Gemini 2.5 Flash
  - `--limit=N` - Only process N artworks
  - `--force` - Start fresh instead of resuming (default: resume)
  - `--batch-size=N` - Save progress every N artworks (default: 10)
- `npm run 3-edit-descriptions-met` - Edit existing descriptions for quality and consistency
  - `--limit=N` - Only edit N descriptions
  - `--force` - Start fresh instead of resuming (default: resume)
  - `--batch-size=N` - Save progress every N descriptions (default: 50)
  - `--skip-clean` - Only edit descriptions that appear problematic (default: edit all)
- `npm run 4-generate-jina-embeddings-met` - Generate Jina v3 text embeddings
  - `--limit=N` - Only process N artworks
  - `--batch-size=N` - Save progress every N artworks (default: 10)
- `npm run 5-generate-siglip2-embeddings-met` - Generate SigLIP 2 cross-modal embeddings
  - `--limit=N` - Only process N artworks
  - `--batch-size=N` - Save progress every N artworks (default: 16)
- `npm run 6-generate-similar-artworks-met` - Generate AI-curated similar artwork recommendations
  - `--limit=N` - Only process N artworks
  - `--artwork-ids=id1,id2` - Process specific artwork IDs (comma-separated)
- `npm run 7-update-similarities-met` - Update Elasticsearch with AI-curated similar artworks
  - `--limit=N` - Only update N artworks
- `npm run 9-generate-umap-projections-met` - Generate UMAP projections for visualization
  - `--limit=N` - Only process N artworks
  - Creates 2D and 3D projections for each embedding type
- `npm run 10-index-artworks` - Index artworks into Elasticsearch
  - `--force` - Force recreate the index (WARNING: deletes all existing data)
  - `--limit N` - Only index N artworks (useful for testing)
- `npm run setup-siglip2` - Install Python dependencies for SigLIP 2 (one-time setup)
- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm run start` - Start production server

## Data Pipeline

### Indexing Pipeline
1. **Museum CSV** → Parse metadata → Generate visual descriptions (Gemini)
2. **Optional but recommended** → Edit descriptions for quality and consistency (Gemini)
3. **Artwork images** → Generate SigLIP 2 embeddings (local Python script)
4. **Metadata + descriptions** → Generate Jina v3 embeddings (local Python script)
5. **Optional but recommended** → Generate AI-curated similar artworks (Gemini 2.5 Flash)
6. **Similar artwork data** → Update Elasticsearch documents with curated recommendations
7. **Embeddings** → Generate UMAP projections for visualization (2D/3D dimensionality reduction)
8. **All data** → Index to Elasticsearch with embeddings, descriptions, and projections

### Search Pipeline  
1. **User query** → Modal API (single call) → Both embeddings
2. **Embeddings** → Parallel search execution (keyword, semantic, hybrid)
3. **Results** → Ranking/fusion → UI presentation

See [DATA_PIPELINE.md](DATA_PIPELINE.md) for detailed documentation.

## Technical Architecture

### Core Stack
- **Frontend**: Next.js 15 with TypeScript
- **UI Components**: Shadcn/ui with Tailwind CSS  
- **Search Engine**: Elasticsearch 8.19.1
- **Images**: Direct URLs from museum servers (MoMA)

### Embedding Architecture

#### Models
- **Jina v3** (`jina-embeddings-v3`): 768-dimensional text embeddings
  - Combines artwork metadata with AI-generated visual descriptions
  - Task-specific: "retrieval.passage" for indexing, "retrieval.query" for search
  
- **SigLIP 2** (`google/siglip2-base-patch16-224`): 768-dimensional cross-modal embeddings
  - True text-to-image search in shared vector space
  - Enables natural language queries about visual content

#### Unified Embeddings API

The system uses a unified Modal deployment that returns both embeddings in a single call:

```typescript
// Single API call for both embeddings
const response = await generateUnifiedEmbeddings("abstract painting");
// Returns: { 
//   embeddings: {
//     siglip2: { embedding: [...], dimension: 768 },
//     jina_v3: { embedding: [...], dimension: 768 }
//   }
// }
```

**Benefits:**
- One API call per search instead of multiple
- Reduced latency and cost
- Consistent embeddings across all search types
- GPU-accelerated inference via Modal

#### Search Flow

1. User enters search query
2. Frontend calls search API
3. Search API makes ONE call to Modal unified embeddings endpoint
4. Both SigLIP 2 and Jina v3 embeddings returned
5. Embeddings used for all requested search types (semantic, hybrid)
6. Results returned to user


## Troubleshooting

### Modal API Issues
- **403 Error**: Check that MODAL_EMBEDDING_URL is set correctly in `.env.local`
- **Timeout**: First request after idle may take 10-15s (model loading)
- **No Jina embeddings**: Ensure Modal deployment includes both models

### Search Issues  
- **No results**: Check Elasticsearch is running and artworks are indexed
- **Slow searches**: Ensure Modal API is being used (check browser network tab)
- **Missing embeddings**: Run the generation scripts for both models

### Development
- **Port conflicts**: The app will auto-select next available port
- **Memory issues**: Reduce batch size in embedding generation scripts

### Content Filtering Issues

When processing museum artworks, Gemini's safety filters may block certain historical artworks containing:

1. **Exposed skin/nudity**:
   - Artworks with phrases like "revealing her upper torso" or "sits naked"
   - Classical paintings with nude figures (common in art history)
   - Mother and child paintings (e.g., Bouguereau)

2. **Detailed physical descriptions**:
   - Historical portraits describing women's features
   - Traditional art depicting human bodies
   - Religious or mythological scenes with violence

These safety filters cannot distinguish between:
- Historical/artistic content vs. inappropriate content
- Academic descriptions vs. problematic content
- Museum collections vs. general imagery

**Affected artworks** will fail with `PROHIBITED_CONTENT` errors. The scripts will skip these and continue processing other artworks. Consider maintaining a separate list of blocked artworks for manual review or alternative processing approaches.

## Various Notes

In developing this project I tried out a number of different models:

1. **Jina Embeddings** performed very well across all their models:
   - **JinaCLIP v2** provided highly relevant results for visual art search
   - **Jina v3** delivered excellent text-only semantic search capabilities
   - **Jina v4** matched Google's performance for multimodal search with 2048-dimensional embeddings

2. **SigLIP vs CLIP**: SigLIP 2 over CLIP for several reasons:
   - Better performance on natural language queries
   - Improved localization capabilities
   - More robust to variations in query phrasing
   - Consistent 768-dimensional output matching Jina v3

3. **Cohere Embed 4** did not produce results as relevant as other models for art-related queries.

4. **Voyage Multimodal 3** had significant rate limiting issues on the free tier (3 requests/minute). Search results were not as relevant as Jina models or Google Vertex AI for art-related queries.

### Multimodal Embeddings

I tested multimodal embeddings that combined artwork metadata (title, artist, medium, etc.) with images. Testing revealed that both Jina v4 and Google Vertex produce nearly identical embeddings whether using image-only or image+text inputs.  Apparently the image features dominate so heavily that text contributes negligibly to the final embedding. More research needed. 

Eventually I found that separate image-only embeddings and text-only embeddings worked better.  And hybrid search that ranks results from keyword, image embedding, and text embedding searches, worked best.
