#!/bin/bash

# Deploy the Modal embedding API with performance optimizations

echo "Deploying Modal embedding API..."
echo ""
echo "Features enabled:"
echo "  ✓ Pre-downloaded models in Docker image"
echo "  ✓ GPU optimizations (CUDA, TF32)"
echo "  ✓ 10-minute idle timeout"
echo "  ✓ Scales to zero when idle (cost-effective POC)"
echo ""

# Check if modal is installed
if ! command -v modal &> /dev/null; then
    echo "Error: Modal CLI not found. Install it with: pip install modal"
    exit 1
fi

# Deploy the API
modal deploy modal/embedding_api.py

echo ""
echo "Deployment complete!"
echo ""
echo "Note: Container will scale to zero when idle to minimize costs."
echo "First request after idle will have ~5-10s cold start."