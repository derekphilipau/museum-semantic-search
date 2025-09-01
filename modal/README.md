# Modal Embeddings API

This Modal deployment provides a unified API for generating both SigLIP 2 (cross-modal) and Jina v3 (text) embeddings for museum artwork search.

## Features

- **Dual Model Support**: Handles both SigLIP 2 and Jina v3 embeddings in a single deployment
- **GPU Acceleration**: Uses T4 GPU for fast inference
- **Auto-scaling**: Modal handles scaling automatically based on load
- **Persistent Models**: Models are loaded once and kept warm between requests

## Setup

1. Install Modal CLI:
```bash
pip install modal
```

2. Authenticate with Modal:
```bash
modal setup
```

3. Deploy the API:
```bash
cd modal
./deploy.sh
# or
modal deploy embedding_api.py
```

4. Get your endpoint URL:
```bash
modal app list
```

5. Update `.env.local`:
```env
MODAL_EMBEDDING_API_URL=https://your-username--museum-embeddings-embed-text.modal.run
```

## API Usage

### Generate Embeddings

**Endpoint**: `POST /`

**Request Body**:
```json
{
  "text": "abstract painting"
}
```

**Response** (returns both embeddings):
```json
{
  "text": "abstract painting",
  "embeddings": {
    "siglip2": {
      "embedding": [0.123, -0.456, ...],
      "dimension": 768,
      "processing_time": 0.045
    },
    "jina_v3": {
      "embedding": [0.789, -0.234, ...],
      "dimension": 768,
      "processing_time": 0.032
    }
  },
  "total_processing_time": 0.078,
  "device": "cuda"
}
```

### Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "healthy",
  "models": {
    "siglip2": "Cross-modal text-to-image search",
    "jina_v3": "Advanced text search"
  },
  "response_format": "Returns both embeddings in a single request"
}
```

## Model Details

### SigLIP 2
- **Model**: `google/siglip2-base-patch16-224`
- **Dimensions**: 768
- **Use Case**: Cross-modal search (text queries to find images)
- **Task**: Search for artworks by visual description

### Jina v3
- **Model**: `jinaai/jina-embeddings-v3`
- **Dimensions**: 768 (truncated from original)
- **Use Case**: Text-to-text search
- **Task**: Search for artworks by metadata and descriptions

## Testing

Test embeddings (returns both):
```bash
curl -X POST https://your-modal-url.modal.run \
  -H "Content-Type: application/json" \
  -d '{"text": "colorful abstract painting"}' \
  | jq '.'
```

Extract just the SigLIP 2 embedding:
```bash
curl -X POST https://your-modal-url.modal.run \
  -H "Content-Type: application/json" \
  -d '{"text": "colorful abstract painting"}' \
  | jq '.embeddings.siglip2.embedding[:5]'  # First 5 values
```

Extract just the Jina v3 embedding:
```bash
curl -X POST https://your-modal-url.modal.run \
  -H "Content-Type: application/json" \
  -d '{"text": "Jackson Pollock drip painting"}' \
  | jq '.embeddings.jina_v3.embedding[:5]'  # First 5 values
```

## Cost Estimation

- **GPU Time**: ~$0.000111 per second on T4
- **Average Request**: ~0.05-0.1 seconds
- **Cost per Request**: ~$0.000006-0.000011
- **Container Idle**: Keeps warm for 5 minutes after last request

## Monitoring

View logs and metrics:
```bash
modal app logs museum-embeddings
```

## Troubleshooting

1. **Model Loading Timeout**: Increase memory allocation in `embedding_api.py`
2. **Cold Starts**: First request after idle takes ~10-15s to load models
3. **Rate Limits**: Adjust `concurrency_limit` in the deployment configuration