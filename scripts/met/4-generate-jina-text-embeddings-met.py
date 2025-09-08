#!/usr/bin/env python3
"""
Generate Jina v3 embeddings for Met museum artworks.
Combines artwork metadata with AI visual descriptions for enhanced semantic search.
"""

import os
import json
import argparse
import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set
from transformers import AutoModel
import torch

# Configuration
MODEL_ID = "jinaai/jina-embeddings-v3"
MODEL_KEY = "jina_v3"  # This will be the directory name
BATCH_SIZE = 16  # Adjust based on your RAM
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "met"
OUTPUT_DIR = DATA_DIR / "embeddings" / MODEL_KEY
MET_CSV = DATA_DIR / "MetPaintingsWithImages.csv"
DESCRIPTIONS_DIR = DATA_DIR / "descriptions" / "gemini_2_5_flash"

class JinaV3Embedder:
    def __init__(self, device: str = "mps"):  # mps for Apple Silicon
        """Initialize Jina v3 embeddings model."""
        print(f"Loading {MODEL_ID} on {device}...")
        self.device = device
        self.model = AutoModel.from_pretrained(
            MODEL_ID, 
            trust_remote_code=True,
            device_map=device if device != "mps" else None
        )
        
        # Move to MPS manually if needed
        if device == "mps" and torch.backends.mps.is_available():
            self.model = self.model.to(device)
        elif device == "cuda" and torch.cuda.is_available():
            self.model = self.model.to(device)
        
        print(f"✓ Model loaded successfully on {device}")
    
    def generate_embedding(self, text: str, task: str = "retrieval.passage") -> List[float]:
        """Generate embedding for text using Jina v3."""
        # Jina v3 supports task-specific embeddings
        # For indexing, use "retrieval.passage"
        # For queries, use "retrieval.query"
        embeddings = self.model.encode(
            [text],
            task=task,
            truncate_dim=768  # Truncate to 768 dims to match other models
        )
        return embeddings[0].tolist()

def load_existing_embeddings(output_path: Path) -> Set[str]:
    """Load IDs of artworks that already have embeddings."""
    existing_ids = set()
    
    if not output_path.exists():
        return existing_ids
    
    print("Loading existing embeddings...")
    with open(output_path, 'r') as f:
        for line in f:
            if line.strip():
                try:
                    record = json.loads(line)
                    existing_ids.add(record['artwork_id'])
                except:
                    continue
    
    print(f"Found {len(existing_ids)} existing embeddings")
    return existing_ids

def load_met_csv(csv_path: Path) -> List[Dict]:
    """Load Met artworks from CSV file."""
    artworks = []
    
    print("Reading Met paintings CSV...")
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # MetPaintingsWithImages.csv already contains only paintings with images
            object_id = row.get('Object ID', '')
            
            # Parse pipe-delimited fields
            titles = row.get('Title', '').split('|') if '|' in row.get('Title', '') else [row.get('Title', '')]
            artists = row.get('Artist Display Name', '').split('|') if '|' in row.get('Artist Display Name', '') else [row.get('Artist Display Name', '')]
            tags = row.get('Tags', '').split('|') if row.get('Tags') else []
            
            artwork = {
                "id": f"met_{object_id}",
                "title": titles[0].strip() if titles else '',  # Primary title
                "titles": [t.strip() for t in titles if t.strip()],  # All titles
                "artist": artists[0].strip() if artists else '',  # Primary artist
                "artists": [a.strip() for a in artists if a.strip()],  # All artists
                "date": row.get('Object Date', ''),
                "medium": row.get('Medium', ''),
                "classification": row.get('Classification', ''),
                "department": row.get('Department', ''),
                "culture": row.get('Culture', ''),
                "period": row.get('Period', ''),
                "dynasty": row.get('Dynasty', ''),
                "reign": row.get('Reign', ''),
                "portfolio": row.get('Portfolio', ''),
                "artistBio": row.get('Artist Display Bio', ''),
                "artistNationality": row.get('Artist Nationality', ''),
                "artistRole": row.get('Artist Role', ''),
                "creditLine": row.get('Credit Line', ''),
                "dimensions": row.get('Dimensions', ''),
                "objectName": row.get('Object Name', ''),
                "city": row.get('City', ''),
                "state": row.get('State', ''),
                "country": row.get('Country', ''),
                "region": row.get('Region', ''),
                "subregion": row.get('Subregion', ''),
                "locale": row.get('Locale', ''),
                "tags": [t.strip() for t in tags if t.strip()],
                "hasImage": True
            }
            
            artworks.append(artwork)
                
    return artworks

def load_descriptions_map(descriptions_path: Path, edited_path: Path = None) -> Dict[str, Dict]:
    """Load AI visual descriptions into a map, prioritizing edited versions."""
    descriptions = {}
    
    # First load original descriptions
    if descriptions_path.exists():
        print(f"Loading descriptions from {descriptions_path.name}...")
        with open(descriptions_path, 'r') as f:
            for line in f:
                if line.strip():
                    try:
                        record = json.loads(line)
                        descriptions[record['artwork_id']] = record
                    except:
                        continue
        print(f"  Loaded {len(descriptions)} original descriptions")
    
    # Then load edited descriptions (overwrite originals)
    if edited_path is None:
        edited_path = descriptions_path.parent / "edited_descriptions.jsonl"
    
    if edited_path.exists():
        print(f"Loading edited descriptions from {edited_path.name}...")
        edited_count = 0
        with open(edited_path, 'r') as f:
            for line in f:
                if line.strip():
                    try:
                        record = json.loads(line)
                        descriptions[record['artwork_id']] = record
                        edited_count += 1
                    except:
                        continue
        print(f"  Loaded {edited_count} edited descriptions")
    
    return descriptions

def create_text_for_embedding(artwork: Dict, description: Optional[Dict]) -> str:
    """Create comprehensive text representation of artwork for embedding."""
    parts = []
    
    # AI visual descriptions (if available) - HIGHEST PRIORITY
    if description:
        if description.get('alt_text'):
            parts.append(f"Visual description: {description['alt_text']}")
        if description.get('long_description'):
            parts.append(f"Detailed description: {description['long_description']}")
    
    # Handle multi-value title field
    if artwork.get('titles'):
        # Include all titles for better search coverage
        parts.append(f"Title: {'; '.join(artwork['titles'])}")
    elif artwork.get('title'):
        parts.append(f"Title: {artwork['title']}")
    
    # Handle multi-value artist field
    if artwork.get('artists'):
        # Include all artists
        parts.append(f"Artist: {'; '.join(artwork['artists'])}")
    elif artwork.get('artist'):
        parts.append(f"Artist: {artwork['artist']}")
    
    # Tags (already parsed as list) - HIGH VALUE
    if artwork.get('tags'):
        parts.append(f"Tags: {', '.join(artwork['tags'])}")
    
    # Medium - important for material/technique searches
    if artwork['medium']:
        parts.append(f"Medium: {artwork['medium']}")
    
    # Object type and classification
    if artwork.get('objectName'):
        parts.append(f"Object type: {artwork['objectName']}")
    if artwork['classification']:
        parts.append(f"Classification: {artwork['classification']}")
    
    # Cultural and temporal context
    if artwork['culture']:
        parts.append(f"Culture: {artwork['culture']}")
    if artwork['period']:
        parts.append(f"Period: {artwork['period']}")
    if artwork['dynasty']:
        parts.append(f"Dynasty: {artwork['dynasty']}")
    if artwork['reign']:
        parts.append(f"Reign: {artwork['reign']}")
    if artwork['date']:
        parts.append(f"Date: {artwork['date']}")
    
    # Geographic context - only country for broad context
    if artwork['country']:
        parts.append(f"Country: {artwork['country']}")
    
    # Join all parts with periods for better sentence structure
    return ". ".join(parts)

def process_artwork(embedder: JinaV3Embedder, artwork: Dict, description: Optional[Dict], writer, debug: bool = False) -> Dict:
    """Process a single artwork and generate embedding."""
    try:
        # Create comprehensive text
        text = create_text_for_embedding(artwork, description)
        
        if not text.strip():
            print(f"  ⚠️  No text content for artwork {artwork['id']}")
            return {"processed": 0, "skipped": 1, "failed": 0}
        
        # Debug output - show full text
        if debug:
            print(f"\n  📝 Text for embedding ({len(text)} chars):")
            print(f"  {text}")
        
        # Generate embedding
        embedding = embedder.generate_embedding(text, task="retrieval.passage")
        
        # Create record
        record = {
            "artwork_id": artwork["id"],
            "embedding": embedding,
            "timestamp": datetime.now().isoformat(),
            "model": MODEL_KEY,
            "dimension": len(embedding),
            "metadata": {
                "title": artwork["title"],
                "artist": artwork["artist"] or "Unknown",
                "collection": "Metropolitan Museum of Art",
                "has_image": True,
                "has_description": description is not None
            }
        }
        
        writer.write(json.dumps(record) + '\n')
        writer.flush()  # Ensure immediate write
        print(f"  ✓ Success ({len(embedding)} dimensions)")
        return {"processed": 1, "skipped": 0, "failed": 0}
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return {"processed": 0, "skipped": 0, "failed": 1}

def main():
    parser = argparse.ArgumentParser(description='Generate Jina v3 embeddings for Met artworks')
    parser.add_argument('--device', type=str, default='mps', help='Device to use: cpu, cuda, mps')
    parser.add_argument('--limit', type=int, help='Limit number of artworks to process')
    parser.add_argument('--artwork-ids', type=str, help='Specific artwork IDs to process (comma-separated)')
    parser.add_argument('--debug', action='store_true', help='Show text being embedded')
    
    args = parser.parse_args()
    
    print('Jina v3 Embeddings Generator for Met Museum')
    print('==========================================')
    print(f'Model: {MODEL_ID}')
    print(f'Output: {OUTPUT_DIR}')
    print(f'Device: {args.device}')
    print(f'Debug: {args.debug}')
    
    # Load artworks from CSV
    print('\nLoading Met paintings from CSV...')
    artworks = load_met_csv(MET_CSV)
    print(f'Found {len(artworks)} total paintings')
    
    # Load AI descriptions
    print('\nLoading AI visual descriptions...')
    descriptions_path = DESCRIPTIONS_DIR / "descriptions.jsonl"
    edited_path = DESCRIPTIONS_DIR / "edited_descriptions.jsonl"
    descriptions = load_descriptions_map(descriptions_path, edited_path)
    print(f'Total descriptions available: {len(descriptions)}')
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "embeddings.jsonl"
    
    # Load existing embeddings for idempotency
    existing_ids = load_existing_embeddings(output_path)
    
    # Filter artworks
    if args.artwork_ids:
        # Process specific artwork IDs
        requested_ids = set(f"met_{id.strip()}" if not id.startswith('met_') else id.strip() 
                           for id in args.artwork_ids.split(','))
        artworks = [a for a in artworks if a['id'] in requested_ids]
        print(f'\nProcessing {len(artworks)} specific artworks')
    else:
        # Skip already processed
        artworks = [a for a in artworks if a['id'] not in existing_ids]
        print(f'\nFound {len(artworks)} artworks to process (skipping {len(existing_ids)} already done)')
    
    if not artworks:
        print('No artworks to process!')
        return
    
    # Apply limit if specified
    if args.limit and len(artworks) > args.limit:
        artworks = artworks[:args.limit]
        print(f'Limited to {len(artworks)} artworks')
    
    # Initialize model
    embedder = JinaV3Embedder(device=args.device)
    
    # Process artworks
    print(f'\nProcessing {len(artworks)} artworks...\n')
    
    total_processed = 0
    total_skipped = 0
    total_failed = 0
    
    # Open in append mode for idempotency
    with open(output_path, 'a') as writer:
        for i, artwork in enumerate(artworks):
            description = descriptions.get(artwork["id"])
            
            # Handle multiple titles/artists in display
            display_title = artwork['titles'][0] if artwork.get('titles') else artwork['title']
            display_artist = artwork['artists'][0] if artwork.get('artists') else artwork['artist'] or 'Unknown'
            
            print(f'[{i + 1}/{len(artworks)}] {display_title} by {display_artist}')
            
            result = process_artwork(embedder, artwork, description, writer, debug=args.debug)
            
            total_processed += result["processed"]
            total_skipped += result["skipped"]
            total_failed += result["failed"]
    
    print('\n\nSummary')
    print('=======')
    print(f'Total processed: {total_processed}')
    print(f'Total skipped: {total_skipped}')
    print(f'Total failed: {total_failed}')
    print(f'\nEmbeddings saved to: {output_path}')

if __name__ == "__main__":
    main()