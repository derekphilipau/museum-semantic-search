#!/usr/bin/env python3
"""
Generate Jina v3 embeddings for museum artworks.
Combines artwork metadata with AI visual descriptions for enhanced semantic search.
"""

import os
import json
import argparse
import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from tqdm import tqdm
from transformers import AutoModel
import torch

# Configuration
MODEL_ID = "jinaai/jina-embeddings-v3"
MODEL_KEY = "jina_v3"  # This will be the directory name
BATCH_SIZE = 16  # Adjust based on your RAM
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "moma"
OUTPUT_DIR = DATA_DIR / "embeddings" / MODEL_KEY
MOMA_CSV = DATA_DIR / "Artworks_50k.csv"
DESCRIPTIONS_DIR = DATA_DIR / "descriptions" / "gemini_2_5_flash"

class JinaV3Embedder:
    def __init__(self, device: str = "mps"):  # mps for Apple Silicon
        """Initialize Jina v3 embeddings model."""
        self.device = device if torch.cuda.is_available() or device == "mps" else "cpu"
        
        print(f"Loading {MODEL_ID} on {self.device}...")
        self.model = AutoModel.from_pretrained(
            MODEL_ID,
            trust_remote_code=True
        )
        
        # Move model to device
        if self.device == "mps":
            # For Apple Silicon
            self.model = self.model.to("mps")
        elif self.device == "cuda":
            self.model = self.model.cuda()
            
        self.model.eval()
        print(f"Model loaded successfully on {self.device}")
    
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
            # Check if has image URL (we want all artworks, not just those with images)
            artwork = {
                "id": f"moma_{row.get('ObjectID', '')}",
                "title": row.get('Title', ''),
                "artist": row.get('Artist', ''),
                "date": row.get('Date', ''),
                "medium": row.get('Medium', ''),
                "classification": row.get('Classification', ''),
                "department": row.get('Department', ''),
                "nationality": row.get('Nationality', ''),
                "artistBio": row.get('ArtistBio', ''),
                "creditLine": row.get('CreditLine', ''),
                "dimensions": row.get('Dimensions', ''),
                "hasImage": bool(row.get('ImageURL', '').strip())
            }
            
            artworks.append(artwork)
                
    return artworks

def load_descriptions_map(descriptions_path: Path) -> Dict[str, Dict]:
    """Load AI visual descriptions into a map."""
    descriptions = {}
    
    if not descriptions_path.exists():
        print(f"Descriptions file not found: {descriptions_path}")
        return descriptions
    
    with open(descriptions_path, 'r') as f:
        for line in f:
            try:
                record = json.loads(line)
                descriptions[record['artwork_id']] = record
            except:
                continue
    
    return descriptions

def create_text_for_embedding(artwork: Dict, description: Optional[Dict]) -> str:
    """Create comprehensive text for embedding by combining metadata and descriptions."""
    parts = []
    
    # Title and artist (most important)
    if artwork['title']:
        parts.append(f"Title: {artwork['title']}")
    if artwork['artist']:
        parts.append(f"Artist: {artwork['artist']}")
    
    # Date and medium
    if artwork['date']:
        parts.append(f"Date: {artwork['date']}")
    if artwork['medium']:
        parts.append(f"Medium: {artwork['medium']}")
    
    # Classification and department
    if artwork['classification']:
        parts.append(f"Type: {artwork['classification']}")
    if artwork['department']:
        parts.append(f"Department: {artwork['department']}")
    
    # Artist details
    if artwork['nationality']:
        parts.append(f"Nationality: {artwork['nationality']}")
    if artwork['artistBio']:
        parts.append(f"Artist bio: {artwork['artistBio']}")
    
    # Physical details
    if artwork['dimensions']:
        parts.append(f"Dimensions: {artwork['dimensions']}")
    if artwork['creditLine']:
        parts.append(f"Credit: {artwork['creditLine']}")
    
    # AI visual descriptions (if available)
    if description:
        if description.get('alt_text'):
            parts.append(f"Visual description: {description['alt_text']}")
        if description.get('long_description'):
            parts.append(f"Detailed description: {description['long_description']}")
    
    # Join all parts with periods for better sentence structure
    return ". ".join(parts)

def process_artwork(embedder: JinaV3Embedder, artwork: Dict, description: Optional[Dict], writer) -> Dict:
    """Process a single artwork and generate embedding."""
    try:
        # Create comprehensive text
        text = create_text_for_embedding(artwork, description)
        
        if not text.strip():
            print(f"  ⚠️  No text content for artwork {artwork['id']}")
            return {"processed": 0, "skipped": 1, "failed": 0}
        
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
                "collection": "MoMA",
                "has_image": artwork["hasImage"],
                "has_description": description is not None
            }
        }
        
        writer.write(json.dumps(record) + '\n')
        print(f"  ✓ Success ({len(embedding)} dimensions, {len(text)} chars)")
        return {"processed": 1, "skipped": 0, "failed": 0}
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return {"processed": 0, "skipped": 0, "failed": 1}

def main():
    parser = argparse.ArgumentParser(description="Generate Jina v3 text embeddings")
    parser.add_argument("--limit", type=int, help="Limit number of artworks to process")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Save progress every N artworks")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--device", default="mps", choices=["mps", "cuda", "cpu"], help="Device to use")
    
    args = parser.parse_args()
    
    # Check if CSV exists
    if not MOMA_CSV.exists():
        print(f"Error: CSV file not found at {MOMA_CSV}")
        return
    
    print('MoMA Artwork Jina v3 Text Embedding Generation')
    print('==============================================')
    print(f'Model: {MODEL_KEY} ({MODEL_ID})')
    print(f'Limit: {args.limit or "all"}')
    print(f'Resume: {args.resume}')
    print(f'Save progress every: {args.batch_size} artworks')
    
    # Load artworks from CSV
    print('\nLoading artworks from CSV...')
    artworks = load_moma_csv(MOMA_CSV)
    print(f'Found {len(artworks)} total artworks')
    
    # Load AI descriptions
    print('\nLoading AI visual descriptions...')
    descriptions_path = DESCRIPTIONS_DIR / "descriptions.jsonl"
    descriptions = load_descriptions_map(descriptions_path)
    print(f'Found {len(descriptions)} visual descriptions')
    
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
    embedder = JinaV3Embedder(device=args.device)
    
    # Open output file
    mode = 'a' if args.resume else 'w'
    with open(output_path, mode) as writer:
        processed_in_session = 0
        start_index = progress["lastProcessedIndex"] + 1
        end_index = min(start_index + args.limit, len(artworks)) if args.limit else len(artworks)
        
        print(f'\nProcessing artworks {start_index + 1} to {end_index}...\n')
        
        for i in range(start_index, end_index):
            artwork = artworks[i]
            description = descriptions.get(artwork["id"])
            
            print(f'[{i + 1}/{end_index}] {artwork["title"]} by {artwork["artist"] or "Unknown"}')
            
            result = process_artwork(embedder, artwork, description, writer)
            
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