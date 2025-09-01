#!/usr/bin/env python3
"""
Simple HTTP server for generating SigLIP text embeddings.
This is used at search time to convert user queries to embeddings.
"""

from flask import Flask, request, jsonify
import torch
from transformers import AutoProcessor, AutoModel
import numpy as np
import os

app = Flask(__name__)

# Configuration
MODEL_ID = "google/siglip2-base-patch16-224"

# Global model instance
model = None
processor = None

def load_model():
    """Load SigLIP model and processor."""
    global model, processor
    
    print(f"Loading {MODEL_ID}...")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModel.from_pretrained(MODEL_ID).to(device).eval()
    
    print(f"Model loaded on {device}")
    return device

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "model": MODEL_ID})

@app.route('/embed/text', methods=['POST'])
def embed_text():
    """Generate text embedding for a query."""
    try:
        data = request.get_json()
        query = data.get('query', '')
        
        if not query:
            return jsonify({"error": "No query provided"}), 400
        
        # Generate embedding
        device = model.device
        inputs = processor(
            text=[query], 
            return_tensors="pt", 
            padding=True, 
            truncation=True,
            max_length=64
        ).to(device)
        
        with torch.no_grad():
            outputs = model.get_text_features(**inputs)
            # Normalize
            outputs = outputs / outputs.norm(p=2, dim=-1, keepdim=True)
        
        embedding = outputs[0].cpu().numpy().tolist()
        
        return jsonify({
            "embedding": embedding,
            "dimension": len(embedding),
            "model": MODEL_ID
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Load model on startup
    device = load_model()
    
    # Run server
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)