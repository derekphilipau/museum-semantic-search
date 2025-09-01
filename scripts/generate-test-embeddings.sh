#!/bin/bash

# Generate 100 embeddings for each model for testing

echo "Generating 100 embeddings for each model..."
echo "============================================"

# Array of models
models=("siglip2" "jina_v3")

# Generate embeddings for each model
echo ""
echo "Processing siglip2..."
echo "-------------------"
npm run generate-siglip2-embeddings -- --limit=100

if [ $? -eq 0 ]; then
    echo "✓ siglip2 completed successfully"
else
    echo "✗ siglip2 failed"
fi

echo ""
echo "Processing jina_v3..."
echo "-------------------"
npm run generate-jina-embeddings -- --limit=100

if [ $? -eq 0 ]; then
    echo "✓ jina_v3 completed successfully"
else
    echo "✗ jina_v3 failed"
fi

echo ""
echo "============================================"
echo "All models processed!"
echo ""
echo "Next steps:"
echo "1. Run: npm run index-artworks -- --force"
echo "2. Start the app: npm run dev"
echo "3. Test the UI at http://localhost:3000"