#!/usr/bin/env python3
"""
Quick script to check how many Met paintings actually have images.
"""

import csv
import requests
import json
from pathlib import Path
import time

def check_met_images(limit=100):
    csv_path = Path(__file__).parent.parent.parent / "data" / "met" / "MetObjects.csv"
    
    paintings_count = 0
    checked_count = 0
    with_images = 0
    
    print(f"Checking first {limit} Met paintings for images...")
    
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Filter for paintings that are public domain
            if (row.get('Classification', '').lower() == 'paintings' and
                row.get('Is Public Domain', '').lower() == 'true'):
                paintings_count += 1
                
                if checked_count >= limit:
                    continue
                
                object_id = row.get('Object ID', '')
                
                try:
                    response = requests.get(
                        f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}",
                        timeout=10
                    )
                    if response.ok:
                        data = response.json()
                        if data.get('primaryImage'):
                            with_images += 1
                            print(f"✓ {object_id}: {row.get('Title', '')[:50]}...")
                        else:
                            print(f"✗ {object_id}: {row.get('Title', '')[:50]}... (no image)")
                    checked_count += 1
                    
                    # Be nice to the API
                    time.sleep(0.1)
                    
                except Exception as e:
                    print(f"! {object_id}: Error - {e}")
                    checked_count += 1
    
    print(f"\nTotal paintings (public domain): {paintings_count}")
    print(f"Checked: {checked_count}")
    print(f"With images: {with_images} ({with_images/checked_count*100:.1f}%)")
    print(f"\nNote: The CSV stated 5,286 paintings have images, but we need to verify via API")

if __name__ == "__main__":
    check_met_images(limit=50)