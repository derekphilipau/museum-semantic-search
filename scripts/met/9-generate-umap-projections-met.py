#!/usr/bin/env python3
"""Generate UMAP projections for artwork embeddings."""

import json
import numpy as np
import umap
from pathlib import Path
import argparse
from tqdm import tqdm
from datetime import datetime
import sys
from typing import Dict, List, Tuple, Optional

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.append(str(project_root))

# Configuration
EMBEDDING_CONFIGS = {
    'jina_v3': {
        'path': project_root / 'data/met/embeddings/jina_v3/embeddings.jsonl',
        'dimension': 768
    },
    'siglip2': {
        'path': project_root / 'data/met/embeddings/siglip2/embeddings.jsonl',
        'dimension': 768  # Update if different
    }
}

UMAP_PARAMS = {
    'standard_2d': {
        'n_components': 2,
        'n_neighbors': 15,
        'min_dist': 0.1,
        'metric': 'cosine',
        'random_state': 42
    },
    'tight_2d': {
        'n_components': 2,
        'n_neighbors': 30,
        'min_dist': 0.01,
        'metric': 'cosine',
        'random_state': 42
    },
    'loose_2d': {
        'n_components': 2,
        'n_neighbors': 10,
        'min_dist': 0.5,
        'metric': 'cosine',
        'random_state': 42
    },
    'standard_3d': {
        'n_components': 3,
        'n_neighbors': 15,
        'min_dist': 0.1,
        'metric': 'cosine',
        'random_state': 42
    }
}


def load_embeddings(embedding_type: str, limit: Optional[int] = None) -> Tuple[List[Dict], np.ndarray, List[str]]:
    """Load embeddings from JSONL file."""
    config = EMBEDDING_CONFIGS[embedding_type]
    embeddings_path = config['path']
    
    if not embeddings_path.exists():
        raise FileNotFoundError(f"Embeddings file not found: {embeddings_path}")
    
    records = []
    embeddings = []
    artwork_ids = []
    
    print(f"Loading {embedding_type} embeddings from {embeddings_path}")
    
    with open(embeddings_path, 'r') as f:
        for i, line in enumerate(tqdm(f, desc="Loading embeddings")):
            if limit and i >= limit:
                break
                
            record = json.loads(line.strip())
            records.append(record)
            embeddings.append(record['embedding'])
            artwork_ids.append(record['artwork_id'])
    
    embeddings_array = np.array(embeddings, dtype=np.float32)
    print(f"Loaded {len(embeddings)} embeddings with shape {embeddings_array.shape}")
    
    return records, embeddings_array, artwork_ids


def generate_projection(embeddings: np.ndarray, projection_type: str) -> np.ndarray:
    """Generate UMAP projection for embeddings."""
    params = UMAP_PARAMS[projection_type]
    print(f"\nGenerating {projection_type} projection with params: {params}")
    
    reducer = umap.UMAP(**params)
    projection = reducer.fit_transform(embeddings)
    
    return projection


def load_artwork_metadata(artwork_ids: List[str]) -> Dict[str, Dict]:
    """Load artwork metadata for enriching projections."""
    metadata_path = project_root / 'data/met/edited_descriptions.jsonl'
    if not metadata_path.exists():
        metadata_path = project_root / 'data/met/descriptions.jsonl'
    
    metadata_map = {}
    
    if metadata_path.exists():
        print(f"Loading metadata from {metadata_path}")
        with open(metadata_path, 'r') as f:
            for line in f:
                record = json.loads(line.strip())
                artwork_id = record.get('artwork_id', record.get('id'))
                if artwork_id in artwork_ids:
                    metadata_map[artwork_id] = {
                        'title': record.get('title', ''),
                        'artist': record.get('artist', ''),
                        'date': record.get('date', ''),
                        'medium': record.get('medium', ''),
                        'tags': record.get('tags', []),
                        'primaryImageSmall': record.get('primaryImageSmall', ''),
                        'alt_text': record.get('alt_text', '')
                    }
    
    # Fallback to CSV data if needed
    csv_path = project_root / 'data/met/MetPaintingsWithImages.csv'
    if csv_path.exists() and len(metadata_map) < len(artwork_ids):
        import pandas as pd
        print(f"Loading additional metadata from {csv_path}")
        df = pd.read_csv(csv_path)
        
        for _, row in df.iterrows():
            artwork_id = f"met_{row['Object ID']}"
            if artwork_id in artwork_ids and artwork_id not in metadata_map:
                tags = row.get('Tags', '').split('|') if pd.notna(row.get('Tags')) else []
                metadata_map[artwork_id] = {
                    'title': str(row.get('Title', '')) if pd.notna(row.get('Title')) else '',
                    'artist': str(row.get('Artist Display Name', '')) if pd.notna(row.get('Artist Display Name')) else '',
                    'date': str(row.get('Object Date', '')) if pd.notna(row.get('Object Date')) else '',
                    'medium': str(row.get('Medium', '')) if pd.notna(row.get('Medium')) else '',
                    'tags': [tag.strip() for tag in tags if tag.strip()],
                    'primaryImageSmall': str(row.get('Link Resource', '')) if pd.notna(row.get('Link Resource')) else '',
                    'alt_text': ''
                }
    
    return metadata_map


def save_projections(
    projection: np.ndarray,
    artwork_ids: List[str],
    embedding_records: List[Dict],
    metadata_map: Dict[str, Dict],
    embedding_type: str,
    projection_type: str
):
    """Save UMAP projections to JSONL file."""
    output_dir = project_root / 'data/met/projections' / embedding_type
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_path = output_dir / f"{projection_type}.jsonl"
    
    print(f"\nSaving projections to {output_path}")
    
    with open(output_path, 'w') as f:
        for i, (artwork_id, coords) in enumerate(zip(artwork_ids, projection)):
            metadata = metadata_map.get(artwork_id, {})
            
            projection_record = {
                'artwork_id': artwork_id,
                'embedding_type': embedding_type,
                'projection_type': projection_type,
                'coordinates': coords.tolist(),
                'metadata': metadata,
                'timestamp': datetime.now().isoformat()
            }
            
            f.write(json.dumps(projection_record) + '\n')
    
    print(f"Saved {len(artwork_ids)} projections")


def generate_projection_stats(projection: np.ndarray, projection_type: str):
    """Generate statistics about the projection."""
    stats = {
        'min': projection.min(axis=0).tolist(),
        'max': projection.max(axis=0).tolist(),
        'mean': projection.mean(axis=0).tolist(),
        'std': projection.std(axis=0).tolist(),
        'shape': projection.shape
    }
    
    print(f"\nProjection statistics for {projection_type}:")
    print(f"  Shape: {stats['shape']}")
    print(f"  Range: [{stats['min']}, {stats['max']}]")
    print(f"  Mean: {stats['mean']}")
    print(f"  Std: {stats['std']}")
    
    return stats


def main():
    parser = argparse.ArgumentParser(description='Generate UMAP projections for artwork embeddings')
    parser.add_argument(
        '--embedding-type',
        choices=['jina_v3', 'siglip2', 'all'],
        default='jina_v3',
        help='Type of embeddings to process'
    )
    parser.add_argument(
        '--projection-type',
        choices=list(UMAP_PARAMS.keys()) + ['all'],
        default='standard_2d',
        help='Type of projection to generate'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of embeddings to process (for testing)'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Overwrite existing projections'
    )
    
    args = parser.parse_args()
    
    # Determine which embeddings and projections to generate
    embedding_types = ['jina_v3', 'siglip2'] if args.embedding_type == 'all' else [args.embedding_type]
    projection_types = list(UMAP_PARAMS.keys()) if args.projection_type == 'all' else [args.projection_type]
    
    for embedding_type in embedding_types:
        try:
            # Load embeddings
            embedding_records, embeddings_array, artwork_ids = load_embeddings(
                embedding_type, 
                limit=args.limit
            )
            
            # Load metadata
            metadata_map = load_artwork_metadata(artwork_ids)
            
            # Generate each projection type
            for projection_type in projection_types:
                output_path = project_root / 'data/met/projections' / embedding_type / f"{projection_type}.jsonl"
                
                if output_path.exists() and not args.force:
                    print(f"\nProjection already exists: {output_path}")
                    print("Use --force to overwrite")
                    continue
                
                # Generate projection
                projection = generate_projection(embeddings_array, projection_type)
                
                # Generate statistics
                stats = generate_projection_stats(projection, projection_type)
                
                # Save projections
                save_projections(
                    projection,
                    artwork_ids,
                    embedding_records,
                    metadata_map,
                    embedding_type,
                    projection_type
                )
                
        except FileNotFoundError as e:
            print(f"Skipping {embedding_type}: {e}")
            continue
        except Exception as e:
            print(f"Error processing {embedding_type}: {e}")
            raise


if __name__ == '__main__':
    main()