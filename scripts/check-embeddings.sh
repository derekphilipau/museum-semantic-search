#!/bin/bash

echo "Checking generated embeddings..."
echo "================================"

models=("siglip2" "jina_v3")

for model in "${models[@]}"; do
    file="/Users/dau/Projects/Github/museum-semantic-search/data/embeddings/$model/embeddings.jsonl"
    if [ -f "$file" ]; then
        count=$(wc -l < "$file")
        echo "$model: $count embeddings"
    else
        echo "$model: No embeddings yet"
    fi
done

echo ""
echo "Total image files: $(ls /Users/dau/Projects/Github/museum-semantic-search/data/images/huggingface/*.jpg 2>/dev/null | wc -l)"