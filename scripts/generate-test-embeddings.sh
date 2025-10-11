#!/bin/bash

# Generate 100 embeddings for each model for testing

echo "Generating 100 embeddings for each model..."
echo "============================================"

echo ""
echo "Processing jina_clip..."
echo "-------------------------------"
npm run 5-generate-image-embeddings-met -- --limit=100

if [ $? -eq 0 ]; then
    echo "✓ jina_clip completed successfully"
else
    echo "✗ jina_clip failed"
fi

echo ""
echo "Processing jina_text..."
echo "-----------------------"
npm run 4-generate-text-embeddings-met -- --limit=100

if [ $? -eq 0 ]; then
    echo "✓ jina_text completed successfully"
else
    echo "✗ jina_text failed"
fi

echo ""
echo "============================================"
echo "All models processed!"
echo ""
echo "Next steps:"
echo "1. Run: npm run index-artworks -- --force"
echo "2. Start the app: npm run dev"
echo "3. Test the UI at http://localhost:3000"
