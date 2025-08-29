# Met Museum Semantic Search - Next.js Version

A modern, simplified implementation of the Met Museum artwork search using Next.js and API-based embeddings.

## Features

- 🎨 Search Met Museum artworks using multiple modes:
  - **Keyword Search**: Traditional text matching
  - **Semantic Search**: AI-powered similarity search
  - **Hybrid Search**: Combines both approaches
- 🚀 Multiple embedding models:
  - JinaCLIP v2 (best for visual art)
  - Voyage Multimodal-3
  - Cohere Embed 4
  - Google Vertex Multimodal (requires additional setup)
- ⚡ Fast, modern UI built with Next.js and Tailwind CSS
- 🔒 Secure API key handling (keys never exposed to client)

## Prerequisites

- Node.js 18+
- Elasticsearch running on `http://localhost:9200`
- API keys for embedding services

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env.local`:
```env
# API Keys
JINA_API_KEY=your_jina_key
VOYAGE_API_KEY=your_voyage_key
COHERE_API_KEY=your_cohere_key
GOOGLE_CLOUD_API_KEY=your_google_key (optional)
GOOGLE_CLOUD_PROJECT_ID=your_project_id (optional)

# Elasticsearch
NEXT_PUBLIC_ELASTICSEARCH_URL=http://localhost:9200
```

3. Copy artwork images to public directory:
```bash
cp /path/to/met_artworks/*.jpg public/images/
```

4. Run the development server:
```bash
npm run dev
```

5. Open http://localhost:3000

## Architecture

- **API Routes**: Server-side endpoints for secure embedding generation
- **React Components**: Modern UI with TypeScript
- **Direct ES Queries**: Browser queries Elasticsearch directly (can be moved server-side)
- **Vercel Ready**: Optimized for deployment on Vercel

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy!

### Self-Hosted

```bash
npm run build
npm start
```

## API Endpoints

- `POST /api/embeddings/text`: Generate text embeddings
  - Body: `{ text: string, model: string }`
  - Returns: `{ embedding: number[], model: string, dimension: number }`

## Data Processing Scripts

The project includes TypeScript scripts for managing the data pipeline:

### Quick Start

```bash
# Set up everything with test data
npm run setup -- --limit=10

# Or run individually:
npm run index-artworks              # Create ES index and load metadata
npm run generate-embeddings         # Generate embeddings for images
```

See [scripts/README.md](scripts/README.md) for detailed documentation.

## Roadmap

- [x] Multi-model comparison view
- [x] TypeScript data processing scripts
- [ ] Image upload for visual search
- [ ] Advanced filtering (department, date, etc.)
- [ ] Server-side Elasticsearch queries
- [ ] Caching layer for embeddings
- [ ] Analytics dashboard

## Benefits Over Previous Architecture

- **Simpler**: Single codebase, one deployment
- **Secure**: API keys on server only
- **Modern**: Latest Next.js features
- **Type-safe**: Full TypeScript
- **Fast**: Optimized builds and caching
- **Scalable**: Ready for production