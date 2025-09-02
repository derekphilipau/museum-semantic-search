#!/usr/bin/env python3
"""
Elasticsearch client configuration for Python scripts.
Supports both local and Elastic Cloud deployments.
"""

import os
from elasticsearch import Elasticsearch
from dotenv import load_dotenv

# Load environment variables
import sys
from pathlib import Path
root_dir = Path(__file__).parent.parent.parent
load_dotenv(root_dir / '.env.local')
load_dotenv(root_dir / '.env')

def get_elasticsearch_client():
    """
    Initialize Elasticsearch client with support for local and cloud deployments.
    """
    es_url = os.getenv('ELASTICSEARCH_URL', 'http://localhost:9200')
    api_key = os.getenv('ELASTICSEARCH_API_KEY')
    cloud_id = os.getenv('ELASTICSEARCH_CLOUD_ID')
    
    # Check if we're using Elastic Cloud
    if cloud_id and api_key:
        # Elastic Cloud configuration
        print(f"Connecting to Elastic Cloud: {cloud_id[:20]}...")
        return Elasticsearch(
            cloud_id=cloud_id,
            api_key=api_key,
            request_timeout=30
        )
    elif api_key and ('elastic.co' in es_url or 'elastic-cloud.com' in es_url):
        # Elastic Cloud with URL (alternative setup)
        print(f"Connecting to Elastic Cloud URL: {es_url}")
        return Elasticsearch(
            [es_url],
            api_key=api_key,
            request_timeout=30
        )
    else:
        # Local Elasticsearch (no auth required)
        print(f"Connecting to local Elasticsearch: {es_url}")
        return Elasticsearch(
            [es_url],
            request_timeout=30
        )

def get_index_name():
    """Get the Elasticsearch index name from environment."""
    return os.getenv('ELASTICSEARCH_INDEX', 'artworks_semantic')

# Test the connection
if __name__ == "__main__":
    try:
        es = get_elasticsearch_client()
        info = es.info()
        print(f"Connected to Elasticsearch {info['version']['number']}")
        
        index_name = get_index_name()
        if es.indices.exists(index=index_name):
            stats = es.indices.stats(index=index_name)
            doc_count = stats['indices'][index_name]['primaries']['docs']['count']
            print(f"Index '{index_name}' exists with {doc_count:,} documents")
        else:
            print(f"Index '{index_name}' does not exist")
    except Exception as e:
        print(f"Error connecting to Elasticsearch: {e}")