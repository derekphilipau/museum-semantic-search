#!/bin/bash

# Generate 100 embeddings for each model for testing

echo "Generating 100 embeddings for each model..."
echo "============================================"

# Array of models
models=("jina_clip_v2" "google_vertex_multimodal")

# Generate embeddings for each model
for model in "${models[@]}"; do
    echo ""
    echo "Processing $model..."
    echo "-------------------"
    npm run generate-embeddings-to-file -- --model=$model --limit=100
    
    if [ $? -eq 0 ]; then
        echo "✓ $model completed successfully"
    else
        echo "✗ $model failed"
    fi
done

echo ""
echo "============================================"
echo "All models processed!"
echo ""
echo "Next steps:"
echo "1. Run: npm run index-with-embeddings -- --force"
echo "2. Start the app: npm run dev"
echo "3. Test the UI at http://localhost:3000"