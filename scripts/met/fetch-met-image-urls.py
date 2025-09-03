#!/usr/bin/env python3
"""
Pre-fetch all Met painting image URLs and cache them.
This avoids hitting the API repeatedly in different scripts.
Includes exponential backoff, rate limiting, and robust error handling.
"""

import csv
import json
import requests
import time
from pathlib import Path
from datetime import datetime
from typing import Optional
import argparse
import sys

class MetAPIFetcher:
    def __init__(self, cache_path: Path, delay: float = 2.0):
        self.cache_path = cache_path
        self.base_delay = delay
        self.session = requests.Session()
        # Add headers to avoid blocks
        self.session.headers.update({
            'User-Agent': 'Museum-Semantic-Search/1.0 (https://github.com/derekphilipau/museum-semantic-search)'
        })
        self.consecutive_403s = 0
        
    def load_cache(self):
        """Load existing cache into memory."""
        cache = {}
        if self.cache_path.exists():
            print(f"Loading existing cache from {self.cache_path}")
            with open(self.cache_path, 'r') as f:
                for line_num, line in enumerate(f, 1):
                    try:
                        entry = json.loads(line.strip())
                        cache[entry['object_id']] = entry
                    except json.JSONDecodeError as e:
                        print(f"Warning: Invalid JSON on line {line_num}: {e}")
            print(f"Loaded {len(cache)} cached entries")
        return cache
    
    def save_entry(self, object_id: str, data: dict):
        """Append a single entry to the cache file."""
        entry = {
            'object_id': object_id,
            'primaryImage': data.get('primaryImage', ''),
            'primaryImageSmall': data.get('primaryImageSmall', ''),
            'title': data.get('title', ''),
            'artistDisplayName': data.get('artistDisplayName', ''),
            'objectDate': data.get('objectDate', ''),
            'hasImage': bool(data.get('primaryImage')),
            'fetched_at': datetime.now().isoformat()
        }
        
        # Append to file
        with open(self.cache_path, 'a') as f:
            f.write(json.dumps(entry) + '\n')
        
        return entry
    
    def fetch_with_backoff(self, object_id: str, max_retries: int = 5):
        """Fetch from API with exponential backoff."""
        url = f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}"
        
        for attempt in range(max_retries):
            try:
                print(f"  Attempt {attempt + 1}/{max_retries} for object {object_id}")
                response = self.session.get(url, timeout=30)
                
                if response.status_code == 200:
                    print(f"  ✓ Success: {response.status_code}")
                    self.consecutive_403s = 0  # Reset counter on success
                    return response.json()
                elif response.status_code == 429:
                    # Rate limited
                    retry_after = response.headers.get('Retry-After', 60)
                    print(f"  ⚠️  Rate limited! Waiting {retry_after} seconds...")
                    time.sleep(int(retry_after))
                elif response.status_code == 403:
                    # Forbidden - likely rate limiting
                    self.consecutive_403s += 1
                    wait_time = min(60 * self.consecutive_403s, 300)  # Max 5 min wait
                    print(f"  ⚠️  403 Forbidden - likely rate limit. Waiting {wait_time}s...")
                    time.sleep(wait_time)
                elif response.status_code == 404:
                    print(f"  ✗ Object not found (404)")
                    return None
                else:
                    print(f"  ✗ HTTP {response.status_code}: {response.text[:100]}")
                    
            except requests.exceptions.Timeout:
                print(f"  ✗ Request timeout")
            except requests.exceptions.ConnectionError as e:
                print(f"  ✗ Connection error: {e}")
            except Exception as e:
                print(f"  ✗ Unexpected error: {type(e).__name__}: {e}")
            
            # Exponential backoff
            if attempt < max_retries - 1:
                wait_time = self.base_delay * (2 ** attempt)
                print(f"  Waiting {wait_time:.1f}s before retry...")
                time.sleep(wait_time)
        
        print(f"  ✗ Failed after {max_retries} attempts")
        return None
    
    def process_paintings(self, csv_path: Path, limit: Optional[int] = None):
        """Process all paintings from CSV."""
        # Load existing cache
        cache = self.load_cache()
        
        # Collect painting IDs to process
        painting_ids = []
        print(f"\nReading CSV from {csv_path}")
        
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if (row.get('Classification', '').lower() == 'paintings' and
                    row.get('Is Public Domain', '').lower() == 'true' and
                    row.get('Link Resource', '').strip()):
                    object_id = row.get('Object ID', '')
                    if object_id and object_id not in cache:
                        painting_ids.append(object_id)
        
        total_in_csv = len(painting_ids) + len(cache)
        print(f"\nFound {total_in_csv} total paintings:")
        print(f"  - Already cached: {len(cache)}")
        print(f"  - To fetch: {len(painting_ids)}")
        
        if not painting_ids:
            print("\nAll paintings already cached!")
            return
        
        # Apply limit if specified
        if limit and limit < len(painting_ids):
            painting_ids = painting_ids[:limit]
            print(f"  - Limited to: {len(painting_ids)}")
        
        # Process each painting
        paintings_with_images = 0
        paintings_without_images = 0
        failed = 0
        
        print(f"\nStarting fetch process (delay: {self.base_delay}s between requests)")
        print("="*60)
        
        for i, object_id in enumerate(painting_ids):
            print(f"\n[{i + 1}/{len(painting_ids)}] Object {object_id}")
            
            # Fetch from API
            data = self.fetch_with_backoff(object_id)
            
            if data is None:
                # For 404s, we already returned None from fetch_with_backoff
                # Just skip this object and continue
                failed += 1
                print(f"  ✗ Skipping object {object_id} (not found in API)")
                continue
            
            # Save to cache
            entry = self.save_entry(object_id, data)
            
            if entry['hasImage']:
                paintings_with_images += 1
                print(f"  ✓ Has image: {entry['title'][:50]}...")
            else:
                paintings_without_images += 1
                print(f"  ✗ No image: {entry['title'][:50]}...")
            
            # Progress summary every 50 items
            if (i + 1) % 50 == 0:
                print(f"\nProgress: {i + 1}/{len(painting_ids)}")
                print(f"  With images: {paintings_with_images}")
                print(f"  Without images: {paintings_without_images}")
                print("="*60)
            
            # Rate limiting delay
            if i < len(painting_ids) - 1:  # Don't delay after last item
                time.sleep(self.base_delay)
        
        # Final summary
        print("\n" + "="*60)
        print("FINAL SUMMARY")
        print("="*60)
        print(f"Total processed: {len(painting_ids)}")
        print(f"With images: {paintings_with_images}")
        print(f"Without images: {paintings_without_images}")
        print(f"Failed: {failed}")
        print(f"\nCache saved to: {self.cache_path}")
        print(f"Total cached entries: {len(cache) + len(painting_ids)}")

def main():
    parser = argparse.ArgumentParser(
        description="Pre-fetch Met painting image URLs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Fetch all paintings (will take ~3 hours at 2s delay)
  python3 scripts/met/fetch-met-image-urls.py
  
  # Test with first 10 paintings
  python3 scripts/met/fetch-met-image-urls.py --limit 10
  
  # Use slower rate if getting 403s
  python3 scripts/met/fetch-met-image-urls.py --delay 3.0
  
  # Resume after interruption (automatic)
  python3 scripts/met/fetch-met-image-urls.py
        """
    )
    parser.add_argument("--limit", type=int, help="Limit number of paintings to fetch")
    parser.add_argument("--delay", type=float, default=2.0, 
                        help="Delay between requests in seconds (default: 2.0)")
    
    args = parser.parse_args()
    
    # Paths
    csv_path = Path(__file__).parent.parent.parent / "data" / "met" / "MetObjects.csv"
    cache_path = Path(__file__).parent.parent.parent / "data" / "met" / "met_image_urls_cache.jsonl"
    
    # Check CSV exists
    if not csv_path.exists():
        print(f"Error: CSV not found at {csv_path}")
        print("Please ensure Met data is downloaded to data/met/")
        sys.exit(1)
    
    print("Met Museum Image URL Fetcher")
    print("="*60)
    print(f"Delay between requests: {args.delay}s")
    print(f"Cache file: {cache_path}")
    
    # Create fetcher and process
    fetcher = MetAPIFetcher(cache_path, delay=args.delay)
    fetcher.process_paintings(csv_path, limit=args.limit)

if __name__ == "__main__":
    main()