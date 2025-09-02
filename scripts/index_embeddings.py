#!/usr/bin/env python3
"""
Index embeddings into Elasticsearch.
Supports both local and Elastic Cloud deployments.
"""

import os
import json
import argparse
from pathlib import Path
from typing import Dict, List, Iterator
from tqdm import tqdm
from lib.elasticsearch_client import get_elasticsearch_client, get_index_name

def load_embeddings(embeddings_dir: Path) -> Iterator[Dict]:
    """Load embeddings from JSON files."""
    for json_file in sorted(embeddings_dir.glob("*.json")):
        with open(json_file, 'r') as f:
            data = json.load(f)
            for item in data:
                yield item

def create_index_if_not_exists(es, index_name: str):
    """Create the index with proper mappings if it doesn't exist."""
    if not es.indices.exists(index=index_name):
        print(f"Creating index: {index_name}")
        
        # Index mapping for artworks with embeddings
        mapping = {
            "mappings": {
                "properties": {
                    "metadata": {
                        "properties": {
                            "id": {"type": "keyword"},
                            "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                            "artist": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                            "date": {"type": "text"},
                            "medium": {"type": "text"},
                            "dimensions": {"type": "text"},
                            "classification": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                            "department": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                            "collection": {"type": "keyword"}
                        }
                    },
                    "embeddings": {
                        "properties": {
                            "jina_v3": {
                                "type": "dense_vector",
                                "dims": 768,
                                "index": True,
                                "similarity": "cosine"
                            },
                            "siglip2": {
                                "type": "dense_vector",
                                "dims": 768,
                                "index": True,
                                "similarity": "cosine"
                            }
                        }
                    },
                    "visual_alt_text": {"type": "text"},
                    "visual_long_description": {"type": "text"}
                }
            }
        }
        
        es.indices.create(index=index_name, body=mapping)
        print(f"Index '{index_name}' created successfully")
    else:
        print(f"Index '{index_name}' already exists")

def index_embeddings(embeddings_dir: Path, model_key: str, batch_size: int = 100):
    """Index embeddings into Elasticsearch."""
    es = get_elasticsearch_client()
    index_name = get_index_name()
    
    # Create index if needed
    create_index_if_not_exists(es, index_name)
    
    # Load and index embeddings
    batch = []
    total_indexed = 0
    
    for doc in tqdm(load_embeddings(embeddings_dir), desc=f"Indexing {model_key} embeddings"):
        # Prepare document for indexing
        doc_id = doc.get('id', doc.get('metadata', {}).get('id'))
        if not doc_id:
            print(f"Warning: Document without ID: {doc}")
            continue
        
        # Structure the document for Elasticsearch
        es_doc = {
            "_index": index_name,
            "_id": doc_id,
            "_source": {
                "metadata": doc.get('metadata', {}),
                "embeddings": {
                    model_key: doc.get('embedding', [])
                }
            }
        }
        
        # Add visual descriptions if present
        if 'visual_alt_text' in doc:
            es_doc['_source']['visual_alt_text'] = doc['visual_alt_text']
        if 'visual_long_description' in doc:
            es_doc['_source']['visual_long_description'] = doc['visual_long_description']
        
        batch.append(es_doc)
        
        # Index batch when full
        if len(batch) >= batch_size:
            bulk_index(es, batch)
            total_indexed += len(batch)
            batch = []
    
    # Index remaining documents
    if batch:
        bulk_index(es, batch)
        total_indexed += len(batch)
    
    print(f"Successfully indexed {total_indexed} documents with {model_key} embeddings")
    
    # Refresh index
    es.indices.refresh(index=index_name)
    
    # Show index stats
    stats = es.indices.stats(index=index_name)
    doc_count = stats['indices'][index_name]['primaries']['docs']['count']
    print(f"Total documents in index: {doc_count:,}")

def bulk_index(es, batch):
    """Bulk index documents with error handling."""
    from elasticsearch.helpers import bulk
    
    try:
        success, failed = bulk(es, batch, raise_on_error=False)
        if failed:
            print(f"Warning: {len(failed)} documents failed to index")
            for item in failed[:5]:  # Show first 5 failures
                print(f"  - {item}")
    except Exception as e:
        print(f"Error during bulk indexing: {e}")

def main():
    parser = argparse.ArgumentParser(description='Index embeddings into Elasticsearch')
    parser.add_argument('embeddings_dir', type=Path, help='Directory containing embedding JSON files')
    parser.add_argument('--model', choices=['jina_v3', 'siglip2'], required=True, 
                       help='Model key for the embeddings')
    parser.add_argument('--batch-size', type=int, default=100, 
                       help='Batch size for bulk indexing')
    
    args = parser.parse_args()
    
    if not args.embeddings_dir.exists():
        print(f"Error: Directory {args.embeddings_dir} does not exist")
        return
    
    # Index the embeddings
    index_embeddings(args.embeddings_dir, args.model, args.batch_size)

if __name__ == "__main__":
    main()