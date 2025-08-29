# Migration Guide: Moving to Separate Repository

## Overview

The Next.js application (`met-search-next`) is a complete rewrite that should be in its own repository. Here's how to migrate it.

## Steps to Create New Repository

### 1. Create New Repository

```bash
# Create new directory
cd ~/Projects/Github
mkdir met-museum-explorer
cd met-museum-explorer

# Initialize git
git init
```

### 2. Copy Files

Copy the entire `met-search-next` directory contents:

```bash
# From the met-semantic-search directory
cp -r met-search-next/* ~/Projects/Github/met-museum-explorer/
cp -r met-search-next/.* ~/Projects/Github/met-museum-explorer/ 2>/dev/null || true
```

### 3. Update Configuration

In the new repository, update paths that reference the parent directory:

1. **Update `scripts/index-artworks.ts`** - Change the metadata path:
   ```typescript
   // Change from:
   const metadataPath = path.join(process.cwd(), '..', 'data', 'met_artworks', 'metadata.json');
   
   // To:
   const metadataPath = path.join(process.cwd(), 'data', 'met_artworks', 'metadata.json');
   ```

2. **Update `scripts/generate-embeddings.ts`** - Change the image path:
   ```typescript
   // Change from:
   const imagePath = path.join(process.cwd(), '..', 'data', 'met_artworks', artwork.image);
   
   // To:
   const imagePath = path.join(process.cwd(), 'data', 'met_artworks', artwork.image);
   ```

### 4. Copy Data Files

```bash
# Copy the Met Museum data
cp -r ../met-semantic-search/data ~/Projects/Github/met-museum-explorer/
```

### 5. Update Image Proxy

Since we won't have the old web-ui running, you have two options:

**Option A: Copy images to public directory**
```bash
mkdir -p public/images
cp data/met_artworks/*.jpg public/images/
```

**Option B: Set up MinIO (recommended for production)**
- Update `next.config.js` to proxy from MinIO directly
- Or implement a proper image storage solution

### 6. Clean Up Files

Remove any references to the old architecture:
- Delete migration-specific files
- Update README to remove references to the old system

### 7. Initialize Git Repository

```bash
# In the new repository
git add .
git commit -m "Initial commit: Met Museum Explorer with Next.js"

# Add remote (create repo on GitHub first)
git remote add origin https://github.com/YOUR_USERNAME/met-museum-explorer.git
git push -u origin main
```

## Repository Structure

```
met-museum-explorer/
├── app/                    # Next.js app directory
├── components/            # React components  
├── lib/                   # Utilities and embedding services
├── scripts/              # Data processing scripts
├── public/               # Static assets
├── data/                 # Met Museum dataset (git-ignored)
├── .env.local           # API keys (git-ignored)
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── next.config.js       # Next.js config
└── README.md            # Project documentation
```

## Environment Variables

Create `.env.local` with your API keys:

```env
# Embedding API Keys
JINA_API_KEY=your_key
VOYAGE_API_KEY=your_key  
COHERE_API_KEY=your_key
GOOGLE_CLOUD_API_KEY=your_key
GOOGLE_CLOUD_PROJECT_ID=your_project_id

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200
NEXT_PUBLIC_ELASTICSEARCH_URL=http://localhost:9200
```

## Running in the New Repository

```bash
# Install dependencies
npm install

# Set up data (first time only)
npm run setup -- --limit=10

# Start development server
npm run dev
```

## Deployment Considerations

1. **Elasticsearch**: You'll need a hosted Elasticsearch instance
2. **Images**: Set up proper image storage (S3, Cloudinary, etc.)
3. **API Keys**: Configure environment variables in your deployment platform
4. **CORS**: Update Elasticsearch to allow requests from your domain

## Benefits of Separate Repository

- Clean, focused codebase
- Independent deployment and versioning
- No legacy code or dependencies
- Easier to maintain and contribute to
- Clear separation of concerns