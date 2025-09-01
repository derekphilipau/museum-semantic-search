#!/usr/bin/env python3
"""Test the Modal embedding deployment"""

import requests
import json
import sys

def test_modal_deployment(base_url):
    """Test all endpoints of the Modal deployment"""
    
    print(f"Testing Modal deployment at: {base_url}")
    print("=" * 60)
    
    # Extract base URL without endpoint
    if base_url.endswith("/embed-text"):
        base_url = base_url[:-11]  # Remove "/embed-text"
    
    # Test 1: Health check
    print("\n1. Testing health endpoint...")
    try:
        response = requests.get(f"{base_url}/health")
        if response.status_code == 200:
            print("✓ Health check passed:", response.json())
        else:
            print("✗ Health check failed:", response.status_code, response.text)
    except Exception as e:
        print("✗ Health check error:", e)
    
    # Test 2: Single embedding
    print("\n2. Testing single text embedding...")
    try:
        response = requests.post(
            f"{base_url}/embed-text",
            headers={"Content-Type": "application/json"},
            json={"text": "a beautiful painting of flowers", "model": "siglip2"}
        )
        
        if response.status_code == 200:
            data = response.json()
            if "embedding" in data:
                print(f"✓ Single embedding success!")
                print(f"  - Dimension: {data.get('dimension', len(data['embedding']))}")
                print(f"  - Processing time: {data.get('processing_time', 'N/A')}s")
                print(f"  - First 5 values: {data['embedding'][:5]}")
            else:
                print("✗ No embedding in response:", data)
        else:
            print("✗ Single embedding failed:", response.status_code, response.text)
    except Exception as e:
        print("✗ Single embedding error:", e)
    
    # Test 3: Batch embedding
    print("\n3. Testing batch embedding...")
    try:
        response = requests.post(
            f"{base_url}/embed-batch",
            headers={"Content-Type": "application/json"},
            json={
                "texts": ["painting", "sculpture", "photography"],
                "model": "siglip2"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "results" in data:
                print(f"✓ Batch embedding success!")
                print(f"  - Count: {data.get('count', len(data['results']))}")
                for i, result in enumerate(data['results']):
                    print(f"  - Text {i+1}: '{result['text']}' -> {len(result.get('embedding', []))} dims")
            else:
                print("✗ No results in response:", data)
        else:
            print("✗ Batch embedding failed:", response.status_code, response.text)
    except Exception as e:
        print("✗ Batch embedding error:", e)
    
    # Test 4: Error handling
    print("\n4. Testing error handling...")
    try:
        response = requests.post(
            f"{base_url}/embed-text",
            headers={"Content-Type": "application/json"},
            json={"text": "", "model": "siglip2"}  # Empty text
        )
        
        if response.status_code != 200 or "error" in response.json():
            print("✓ Error handling works correctly")
        else:
            print("✗ Should have returned an error for empty text")
    except Exception as e:
        print("✗ Error handling test failed:", e)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Use provided URL
        url = sys.argv[1]
    else:
        # Use example URL - user needs to replace with their actual URL
        print("Usage: python test_deployment.py <your-modal-url>")
        print("Example: python test_deployment.py https://username--museum-embeddings-embed-text.modal.run")
        print("\nUsing example URL for demonstration...")
        url = "https://example--museum-embeddings-embed-text.modal.run"
    
    test_modal_deployment(url)