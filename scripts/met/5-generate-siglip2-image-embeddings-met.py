#!/usr/bin/env python3
"""
Generate SigLIP 2 image embeddings for Met museum artworks.
Only generates image embeddings - text queries are handled at search time.
"""

import os
import json
import argparse
import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set
import requests
from PIL import Image
from io import BytesIO
import torch
from transformers import AutoProcessor, AutoModel

# Configuration
MODEL_ID = "google/siglip2-base-patch16-224"
MODEL_KEY = "siglip2"  # This will be the directory name
BATCH_SIZE = 16  # Adjust based on your RAM
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "met"
OUTPUT_DIR = DATA_DIR / "embeddings" / MODEL_KEY
MET_CSV = DATA_DIR / "MetPaintingsWithImages.csv"

class SigLIP2Embedder:
    def __init__(self, device: str = "mps"):  # mps for Apple Silicon
        """Initialize SigLIP 2 model and processor."""
        print(f"Loading {MODEL_ID}...")
        
        # Use MPS (Metal) on Apple Silicon, CPU otherwise
        if device == "mps" and not torch.backends.mps.is_available():
            device = "cpu"
            print("MPS not available, using CPU")
        
        self.device = device
        self.processor = AutoProcessor.from_pretrained(MODEL_ID)
        self.model = AutoModel.from_pretrained(MODEL_ID).to(device).eval()
        
        print(f"Model loaded on {device}")
    
    def encode_images(self, images: List[Image.Image]) -> torch.Tensor:
        """Encode image inputs to embeddings."""
        inputs = self.processor(
            images=images, 
            return_tensors="pt"
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model.vision_model(**inputs)
            image_embeds = outputs.pooler_output
            image_embeds = image_embeds / image_embeds.norm(dim=-1, keepdim=True)
        
        return image_embeds
    
    def generate_image_embedding(self, image: Image.Image) -> List[float]:
        """Generate embedding for a single image."""
        embeddings = self.encode_images([image])
        return embeddings[0].cpu().numpy().tolist()

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

def load_met_csv_with_images(csv_path: Path) -> List[Dict]:
    """Load Met artworks from CSV file with image URLs."""
    artworks = []
    
    print("Reading Met paintings with images CSV...")
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # MetPaintingsWithImages.csv already contains only paintings with images
            # No need to filter
            
            object_id = row.get('Object ID', '')
            
            # Use primaryImageSmall for web-friendly size, fallback to primaryImage
            image_url = row.get('primaryImageSmall', '') or row.get('primaryImage', '')
            if not image_url:
                print(f"Warning: No image URL for object {object_id}")
                continue
                
            artwork = {
                "id": f"met_{object_id}",
                "title": row.get('Title', ''),
                "artist": row.get('Artist Display Name', ''),
                "date": row.get('Object Date', ''),
                "medium": row.get('Medium', ''),
                "classification": row.get('Classification', ''),
                "imageUrl": image_url,
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
                "city": row.get('City', ''),
                "state": row.get('State', ''),
                "country": row.get('Country', ''),
                "region": row.get('Region', ''),
                "subregion": row.get('Subregion', ''),
                "locale": row.get('Locale', ''),
                "tags": row.get('Tags', ''),
                "hasImage": True
            }
            
            artworks.append(artwork)
                
    return artworks

def download_image(url: str, max_retries: int = 3) -> Optional[Image.Image]:
    """Download image from URL with retries."""
    for attempt in range(max_retries):
        try:
            # Add headers to avoid 403 errors
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                img = Image.open(BytesIO(response.content))
                # Convert to RGB if necessary
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                return img
            else:
                print(f"  HTTP {response.status_code} for {url}")
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {str(e)}")
            if attempt < max_retries - 1:
                import time
                time.sleep(2 ** attempt)  # Exponential backoff
    
    return None

def process_artwork(embedder: SigLIP2Embedder, artwork: Dict, writer) -> Dict:
    """Process a single artwork and generate embedding."""
    try:
        # Download image
        print(f"  Downloading image...")
        image = download_image(artwork["imageUrl"])
        
        if image is None:
            print(f"  ✗ Failed to download image")
            return {"processed": 0, "skipped": 0, "failed": 1}
        
        # Generate embedding
        embedding = embedder.generate_image_embedding(image)
        
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
                "collection": "Metropolitan Museum of Art"
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
    parser = argparse.ArgumentParser(description='Generate SigLIP 2 image embeddings for Met artworks')
    parser.add_argument('--device', type=str, default='mps', choices=['cpu', 'cuda', 'mps'], 
                       help='Device to use for computation')
    parser.add_argument('--limit', type=int, help='Limit number of artworks to process')
    parser.add_argument('--artwork-ids', type=str, help='Specific artwork IDs to process (comma-separated)')
    
    args = parser.parse_args()
    
    print('SigLIP 2 Image Embeddings Generator for Met Museum')
    print('==================================================')
    print(f'Model: {MODEL_ID}')
    print(f'Output: {OUTPUT_DIR}')
    print(f'Device: {args.device}')
    
    # Load artworks with images
    print('\nLoading Met paintings with images...')
    artworks = load_met_csv_with_images(MET_CSV)
    print(f'Found {len(artworks)} total paintings with images')
    
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
    embedder = SigLIP2Embedder(device=args.device)
    
    # Process artworks
    print(f'\nProcessing {len(artworks)} artworks...\n')
    
    total_processed = 0
    total_skipped = 0
    total_failed = 0
    
    # Open in append mode for idempotency
    with open(output_path, 'a') as writer:
        for i, artwork in enumerate(artworks):
            # Handle pipe-delimited titles if present
            title = artwork['title']
            if '|' in title:
                title = title.split('|')[0].strip()
            
            artist = artwork['artist'] or 'Unknown'
            if '|' in artist:
                artist = artist.split('|')[0].strip()
            
            print(f'[{i + 1}/{len(artworks)}] {title} by {artist}')
            
            result = process_artwork(embedder, artwork, writer)
            
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