#!/usr/bin/env python3
"""
Download and extract the Met Museum dataset from HuggingFace
"""
import os
import json
import csv
from pathlib import Path
from datasets import load_dataset
from PIL import Image
from tqdm import tqdm
import argparse

# Departments we want to include
ALLOWED_DEPARTMENTS = [
    'European Paintings',
    'Greek and Roman Art',
    'Egyptian Art',
    'Asian Art',
    'Islamic Art',
    'Medieval Art',
    'Ancient Near Eastern Art'
]

def get_allowed_object_ids():
    """
    Read the Met CSV file and get object IDs for allowed departments
    """
    csv_path = Path('data/MetObjects.csv')
    if not csv_path.exists():
        raise FileNotFoundError(
            "MetObjects.csv not found. Please download it first:\n"
            "curl -L https://github.com/metmuseum/openaccess/raw/master/MetObjects.csv -o data/MetObjects.csv"
        )
    
    allowed_ids = set()
    print("Reading Met CSV to find artworks in selected departments...")
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        total_rows = 0
        public_domain_count = 0
        department_matches = 0
        
        for row in reader:
            total_rows += 1
            
            # Check if public domain and in allowed department
            if row.get('Is Public Domain') == 'True':
                public_domain_count += 1
                
                if row.get('Department') in ALLOWED_DEPARTMENTS:
                    department_matches += 1
                    object_id = int(row['Object ID'])
                    allowed_ids.add(object_id)
            
            if total_rows % 50000 == 0:
                print(f"  Processed {total_rows:,} rows...")
    
    print(f"\nCSV Summary:")
    print(f"  Total rows: {total_rows:,}")
    print(f"  Public domain: {public_domain_count:,}")
    print(f"  In selected departments: {department_matches:,}")
    
    return allowed_ids

def download_and_extract_dataset(output_dir='data/images/huggingface', 
                                filter_departments=True,  # Changed back to True
                                limit=None):
    """
    Download the Met Museum dataset from HuggingFace and extract images
    
    Args:
        output_dir: Directory to save images
        filter_departments: Whether to filter by allowed departments
        limit: Limit number of images to download (for testing)
    """
    # Get allowed object IDs from CSV if filtering
    allowed_ids = None
    if filter_departments:
        allowed_ids = get_allowed_object_ids()
        print(f"\nWill extract {len(allowed_ids):,} images from selected departments")
    
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Create metadata file
    metadata_file = output_path / 'metadata.jsonl'
    
    print("\nLoading Met Museum dataset from HuggingFace...")
    print("This will download ~23.6GB of data on first run")
    print("Subsequent runs will use cached data")
    print("")
    
    # Load dataset - this downloads it if not cached
    dataset = load_dataset("miccull/met_museum", split="train")
    
    print(f"Total images in dataset: {len(dataset):,}")
    
    # Limit if requested (for testing)
    if limit:
        dataset = dataset.select(range(min(limit, len(dataset))))
        print(f"\nLimited to {len(dataset)} images for testing")
    
    print(f"\nExtracting images to: {output_path}")
    if filter_departments:
        print(f"Filtering to {len(allowed_ids):,} artworks from selected departments")
    print("This may take a while...\n")
    
    # Process each image
    extracted_count = 0
    skipped_count = 0
    
    with open(metadata_file, 'w') as f:
        for idx, item in enumerate(tqdm(dataset, desc="Processing images")):
            try:
                # Get object ID (field is 'object_id' not 'objectID')
                object_id = item['object_id']
                
                # Skip if not in allowed departments
                if filter_departments and object_id not in allowed_ids:
                    skipped_count += 1
                    continue
                
                # Save image
                image = item['image']  # This is a PIL Image
                image_filename = f"{object_id}.jpg"
                image_path = output_path / image_filename
                
                # Save with reasonable quality
                image.save(image_path, 'JPEG', quality=90, optimize=True)
                extracted_count += 1
                
                # Save metadata
                metadata = {
                    'object_id': object_id,
                    'filename': image_filename,
                    'title': item.get('title', ''),
                    'artist': item.get('artist', ''),  # Note: field name is 'artist' not 'artistDisplayName'
                    'object_name': item.get('object_name', ''),
                    'object_date': item.get('object_date', ''),
                    'medium': item.get('medium', ''),
                    'accession_year': item.get('accession_year', ''),
                    'width': item.get('width', 0),
                    'height': item.get('height', 0),
                    'filesize_bytes': item.get('filesize_bytes', 0),
                    'original_link': item.get('original_link', ''),
                    # Note: department is stored as ID (0) in this dataset, not useful
                    'department_id': item.get('department', 0)
                }
                
                # Write metadata line
                f.write(json.dumps(metadata) + '\n')
                
            except Exception as e:
                print(f"\nError processing item {idx}: {e}")
                continue
    
    print(f"\n✅ Successfully extracted {extracted_count:,} images to {output_path}")
    if filter_departments:
        print(f"⏭️  Skipped {skipped_count:,} images not in selected departments")
    print(f"📄 Metadata saved to: {metadata_file}")
    
    # Print summary statistics
    print("\n=== Summary ===")
    jpg_files = list(output_path.glob("*.jpg"))
    if jpg_files:
        total_size = sum(f.stat().st_size for f in jpg_files)
        avg_size = total_size / len(jpg_files)
        print(f"Total size: {total_size / (1024**3):.2f} GB")
        print(f"Average file size: {avg_size / 1024:.1f} KB")
    else:
        print("No images extracted")
    
    return extracted_count

def main():
    parser = argparse.ArgumentParser(description='Download Met Museum dataset from HuggingFace')
    parser.add_argument('--output-dir', default='data/images/huggingface',
                       help='Directory to save images (default: data/images/huggingface)')
    parser.add_argument('--no-filter', action='store_true',
                       help='Download all images without department filtering')
    parser.add_argument('--limit', type=int, default=None,
                       help='Limit number of images to download (for testing)')
    
    args = parser.parse_args()
    
    # Download and extract
    count = download_and_extract_dataset(
        output_dir=args.output_dir,
        filter_departments=not args.no_filter,
        limit=args.limit
    )
    
    print(f"\n🎉 Done! Downloaded {count:,} images.")
    print("\nNext steps:")
    print("1. Update your indexing script to use these images")
    print("2. Run: npm run index-artworks")
    print("3. Run: npm run generate-embeddings")

if __name__ == "__main__":
    main()