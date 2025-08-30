#!/bin/bash

echo "Checking generated embeddings..."
echo "================================"

models=("jina_clip_v2" "google_vertex_multimodal")

for model in "${models[@]}"; do
    file="/Users/dau/Projects/Github/met-semantic-search-next/data/embeddings/$model/embeddings.jsonl"
    if [ -f "$file" ]; then
        count=$(wc -l < "$file")
        echo "$model: $count embeddings"
    else
        echo "$model: No embeddings yet"
    fi
done

echo ""
echo "Total image files: $(ls /Users/dau/Projects/Github/met-semantic-search-next/data/images/huggingface/*.jpg 2>/dev/null | wc -l)"