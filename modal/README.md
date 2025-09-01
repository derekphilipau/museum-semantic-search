# Modal.com Embedding Service

This directory contains the Modal.com deployment for generating text embeddings for SigLIP cross-modal search.

The service uses a class-based approach to keep the model loaded in memory between requests, eliminating cold starts.

## Setup

1. Install Modal CLI:
```bash
pip install modal
```

2. Authenticate with Modal:
```bash
modal setup
```

3. Deploy the service:
```bash
cd modal
modal deploy embedding_api.py
```

## Endpoints

After deployment, you'll get URLs like:
- `https://[your-username]--museum-embeddings-embed-text.modal.run` - Single text endpoint
- `https://[your-username]--museum-embeddings-embed-batch.modal.run` - Batch processing
- `https://[your-username]--museum-embeddings-health.modal.run` - Health check

## Usage

### Single Text Embedding
```bash
curl -X POST https://[your-url]/embed-text \
  -H "Content-Type: application/json" \
  -d '{"text": "a painting of flowers", "model": "siglip2"}'
```

### Batch Processing
```bash
curl -X POST https://[your-url]/embed-batch \
  -H "Content-Type: application/json" \
  -d '{"texts": ["painting", "sculpture", "photography"], "model": "siglip2"}'
```

## Environment Variables

Add to your `.env.local`:
```
MODAL_EMBEDDING_URL=https://[your-username]--museum-embeddings-embed-text.modal.run
```

## Cost

- T4 GPU: $0.59/hour
- Typical request: ~0.5 seconds
- Cost per request: ~$0.00008
- Container stays warm for 5 minutes between requests
- Free tier includes 30 hours/month

## Monitoring

```bash
# View logs
modal app logs

# Check statistics
modal app stats

# List deployments
modal app list
```