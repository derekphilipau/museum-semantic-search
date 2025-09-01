#!/bin/bash

echo "Deploying Museum Embeddings API to Modal..."
echo "=========================================="

# Check if modal is installed
if ! command -v modal &> /dev/null; then
    echo "Error: Modal CLI not found. Install it with: pip install modal"
    exit 1
fi

# Deploy the app
modal deploy embedding_api.py

echo ""
echo "Deployment complete!"
echo ""
echo "To get your endpoint URL, run:"
echo "  modal app list"
echo ""
echo "Then update your .env.local with:"
echo "  MODAL_EMBEDDING_API_URL=https://your-username--museum-embeddings-embed-text.modal.run"
echo ""
echo "Test the health endpoint:"
echo "  curl https://your-username--museum-embeddings-health.modal.run"