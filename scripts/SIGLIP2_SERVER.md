# SigLIP 2 Text Embedding Server

This server generates text embeddings for SigLIP 2 cross-modal search queries.

## Prerequisites

Install the required dependencies:

```bash
pip install -r scripts/requirements-siglip2.txt
```

## Running the Server

Start the server before using SigLIP search:

```bash
python scripts/siglip2_text_server.py
```

The server will:
- Load the SigLIP 2 model on startup
- Listen on port 5000 by default
- Use Metal Performance Shaders (MPS) on Apple Silicon

## Environment Variables

- `PORT`: Server port (default: 5000)
- `SIGLIP2_SERVER_URL`: URL for the server (default: http://localhost:5000)

## Usage

When SigLIP 2 is selected in the search UI:
1. The search query is sent to this server
2. The server generates a text embedding
3. The embedding is used to search against image embeddings in Elasticsearch

## Note

If the server is not running, SigLIP 2 searches will return empty results with a placeholder embedding.