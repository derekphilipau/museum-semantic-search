#!/usr/bin/env python3
"""
Generate SigLIP 2 image embeddings for museum artworks.
Only generates image embeddings - text queries are handled at search time.
"""

import os
import json
import argparse
import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import requests
from PIL import Image
from io import BytesIO
from tqdm import tqdm
import torch
from transformers import AutoProcessor, AutoModel

# Configuration
MODEL_ID = "google/siglip2-base-patch16-224"
MODEL_KEY = "siglip2"  # This will be the directory name
BATCH_SIZE = 16  # Adjust based on your RAM
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "moma"
OUTPUT_DIR = DATA_DIR / "embeddings" / MODEL_KEY
MOMA_CSV = DATA_DIR / "Artworks_50k.csv"

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
            outputs = self.model.get_image_features(**inputs)
            # Normalize embeddings
            outputs = outputs / outputs.norm(p=2, dim=-1, keepdim=True)
            
        return outputs.cpu()
    
    def download_image(self, url: str) -> Optional[Image.Image]:
        """Download image from URL."""
        try:
            # Add headers to avoid 403 errors
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
            response = requests.get(url, timeout=10, headers=headers)
            response.raise_for_status()
            return Image.open(BytesIO(response.content)).convert("RGB")
        except Exception as e:
            print(f"  Failed to download image: {e}")
            return None

def load_progress(progress_path: Path) -> Dict:
    """Load processing progress."""
    if progress_path.exists():
        with open(progress_path, 'r') as f:
            return json.load(f)
    return {
        "lastProcessedIndex": -1,
        "totalProcessed": 0,
        "totalSkipped": 0,
        "totalFailed": 0,
        "lastArtworkId": "",
        "timestamp": datetime.now().isoformat()
    }

def save_progress(progress_path: Path, progress: Dict):
    """Save processing progress."""
    with open(progress_path, 'w') as f:
        json.dump(progress, f, indent=2)

def load_moma_csv(csv_path: Path) -> List[Dict]:
    """Load MoMA artworks from CSV file."""
    artworks = []
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Check if has image URL
            image_url = row.get('ImageURL', '').strip()
            if not image_url:
                continue
                
            artwork = {
                "id": f"moma_{row.get('ObjectID', '')}",
                "title": row.get('Title', ''),
                "artist": row.get('Artist', ''),
                "date": row.get('Date', ''),
                "medium": row.get('Medium', ''),
                "classification": row.get('Classification', ''),
                "imageUrl": image_url,
                "department": row.get('Department', ''),
                "nationality": row.get('Nationality', ''),
                "artistBio": row.get('ArtistBio', ''),
                "creditLine": row.get('CreditLine', ''),
                "dimensions": row.get('Dimensions', '')
            }
            artworks.append(artwork)
                
    return artworks

def process_artwork(embedder: SigLIP2Embedder, artwork: Dict, writer) -> Dict[str, int]:
    """Process a single artwork and write to JSONL."""
    try:
        # Download and process image
        print(f"  Downloading image...")
        image = embedder.download_image(artwork["imageUrl"])
        
        if not image:
            print("  ✗ Failed to download image")
            return {"processed": 0, "skipped": 1, "failed": 0}
        
        # Generate image embedding
        print(f"  Generating image embedding...")
        image_embeddings = embedder.encode_images([image])
        image_embedding = image_embeddings[0].numpy().tolist()
        
        # Write record
        record = {
            "artwork_id": artwork["id"],
            "embedding": image_embedding,  # Just the image embedding
            "timestamp": datetime.now().isoformat(),
            "model": MODEL_KEY,
            "dimension": len(image_embedding),
            "metadata": {
                "title": artwork["title"],
                "artist": artwork["artist"] or "Unknown",
                "collection": "MoMA"
            }
        }
        
        writer.write(json.dumps(record) + '\n')
        print(f"  ✓ Success ({len(image_embedding)} dimensions)")
        return {"processed": 1, "skipped": 0, "failed": 0}
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return {"processed": 0, "skipped": 0, "failed": 1}

def main():
    parser = argparse.ArgumentParser(description="Generate SigLIP 2 image embeddings")
    parser.add_argument("--limit", type=int, help="Limit number of artworks to process")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Save progress every N artworks")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--device", default="mps", choices=["mps", "cuda", "cpu"], help="Device to use")
    
    args = parser.parse_args()
    
    # Check if CSV exists
    if not MOMA_CSV.exists():
        print(f"Error: CSV file not found at {MOMA_CSV}")
        print("Please ensure the MoMA data is in data/moma/Artworks_50k.csv")
        return
    
    print('MoMA Artwork SigLIP 2 Image Embedding Generation')
    print('================================================')
    print(f'Model: {MODEL_KEY} ({MODEL_ID})')
    print(f'Limit: {args.limit or "all"}')
    print(f'Resume: {args.resume}')
    print(f'Save progress every: {args.batch_size} artworks')
    
    # Load artworks from CSV
    print('\nLoading artworks from CSV...')
    artworks = load_moma_csv(MOMA_CSV)
    print(f'Found {len(artworks)} artworks with images')
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Setup file paths
    output_path = OUTPUT_DIR / "embeddings.jsonl"
    progress_path = OUTPUT_DIR / "progress.json"
    
    # Load progress if resuming
    progress = load_progress(progress_path)
    
    if args.resume and progress["lastProcessedIndex"] >= 0:
        print(f'\nResuming from artwork {progress["lastProcessedIndex"] + 1}')
        print(f'Previously processed: {progress["totalProcessed"]}')
        print(f'Previously skipped: {progress["totalSkipped"]}')
        print(f'Previously failed: {progress["totalFailed"]}')
    
    # Initialize model
    embedder = SigLIP2Embedder(device=args.device)
    
    # Open output file
    mode = 'a' if args.resume else 'w'
    with open(output_path, mode) as writer:
        processed_in_session = 0
        start_index = progress["lastProcessedIndex"] + 1
        end_index = min(start_index + args.limit, len(artworks)) if args.limit else len(artworks)
        
        print(f'\nProcessing artworks {start_index + 1} to {end_index}...\n')
        
        for i in range(start_index, end_index):
            artwork = artworks[i]
            print(f'[{i + 1}/{end_index}] {artwork["title"]} by {artwork["artist"] or "Unknown"}')
            
            result = process_artwork(embedder, artwork, writer)
            
            progress["totalProcessed"] += result["processed"]
            progress["totalSkipped"] += result["skipped"]
            progress["totalFailed"] += result["failed"]
            progress["lastProcessedIndex"] = i
            progress["lastArtworkId"] = artwork["id"]
            progress["timestamp"] = datetime.now().isoformat()
            
            processed_in_session += result["processed"]
            
            # Save progress periodically
            if (i - start_index + 1) % args.batch_size == 0:
                save_progress(progress_path, progress)
                print('  → Progress saved\n')
        
        # Final progress save
        save_progress(progress_path, progress)
        
        print('\n\nSummary')
        print('=======')
        print(f'Processed in this session: {processed_in_session}')
        print(f'Total processed: {progress["totalProcessed"]}')
        print(f'Total skipped: {progress["totalSkipped"]}')
        print(f'Total failed: {progress["totalFailed"]}')
        print(f'\nEmbeddings saved to: {output_path}')

if __name__ == "__main__":
    main()