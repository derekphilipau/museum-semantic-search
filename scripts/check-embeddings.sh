#!/bin/bash

echo "Checking generated embeddings..."
echo "================================"

models=("jina_clip" "jina_text")

for model in "${models[@]}"; do
    file="/Users/dau/Projects/Github/museum-semantic-search/data/met/embeddings/$model/embeddings.jsonl"
    if [ -f "$file" ]; then
        count=$(wc -l < "$file")
        echo "$model: $count embeddings"
    else
        echo "$model: No embeddings yet"
    fi
done
