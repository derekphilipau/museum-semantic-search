#!/bin/bash
# Load environment variables from .env.local and run index-artworks

# Load .env.local
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Run the indexing script with all arguments passed through
npm run index-artworks -- "$@"