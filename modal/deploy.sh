#!/bin/bash
# Deploy script for Modal embedding service

echo "Deploying Modal embedding service..."
echo "=================================="

# Check if modal is installed
if ! command -v modal &> /dev/null; then
    echo "Error: Modal CLI not found. Please install with: pip install modal"
    exit 1
fi

# Check if authenticated
if ! modal config show &> /dev/null; then
    echo "Error: Not authenticated with Modal. Please run: modal setup"
    exit 1
fi

# Deploy the service
echo "Deploying embedding_api.py..."
modal deploy embedding_api.py

# Show the deployment URL
echo ""
echo "Deployment complete! Your endpoints are:"
echo ""
modal app list | grep museum-embeddings

echo ""
echo "To add the URL to your .env.local file:"
echo "MODAL_EMBEDDING_URL=https://[your-username]--museum-embeddings-embed-text.modal.run"
echo ""
echo "To test the deployment:"
echo "python test_deployment.py https://[your-username]--museum-embeddings-embed-text.modal.run"