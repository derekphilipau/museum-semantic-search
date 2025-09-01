import modal
import base64
from io import BytesIO
from typing import Optional, Dict, Any

app = modal.App("museum-embeddings")

image = modal.Image.debian_slim().pip_install(
    "fastapi",  # Required for web endpoints
    "transformers>=4.44.0",
    "torch>=2.0.0",
    "accelerate>=0.25.0",
    "pillow>=10.0.0",
    "einops>=0.7.0",  # Required for Jina
)

# Use a class to persist models between requests
@app.cls(
    image=image,
    gpu="t4",
    memory=12288,  # Increased for both models
    scaledown_window=300,  # Keep warm for 5 minutes
    max_containers=10,  # Handle up to 10 concurrent requests
)
class EmbeddingModel:
    @modal.enter()
    def setup(self):
        """Load both models once when container starts"""
        import torch
        from transformers import AutoModel, AutoProcessor
        import time
        
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Load SigLIP2 for cross-modal search
        start_time = time.time()
        print("Loading SigLIP2 model...")
        self.siglip_processor = AutoProcessor.from_pretrained("google/siglip2-base-patch16-224")
        self.siglip_model = AutoModel.from_pretrained(
            "google/siglip2-base-patch16-224",
            torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
        ).to(self.device).eval()
        print(f"SigLIP2 loaded in {time.time() - start_time:.2f}s")
        
        # Load Jina for text-to-text search
        start_time = time.time()
        print("Loading Jina v3 model...")
        self.jina_model = AutoModel.from_pretrained(
            'jinaai/jina-embeddings-v3',
            trust_remote_code=True,
            torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
        ).to(self.device).eval()
        print(f"Jina v3 loaded in {time.time() - start_time:.2f}s")
        
        print(f"Both models ready on {self.device}")
    
    @modal.method()
    def embed(self, text: Optional[str] = None, image_base64: Optional[str] = None) -> dict:
        """Generate embeddings for text or image with appropriate models"""
        import torch
        import time
        from PIL import Image
        
        overall_start = time.time()
        embeddings = {}
        input_type = "text" if text else "image"
        
        if image_base64:
            # Process image input
            try:
                # Decode base64 image
                if image_base64.startswith('data:image'):
                    # Remove data URL prefix
                    image_base64 = image_base64.split(',', 1)[1]
                
                image_bytes = base64.b64decode(image_base64)
                image = Image.open(BytesIO(image_bytes)).convert('RGB')
                
                # SigLIP2 expects 224x224 images
                # The processor will handle resizing, but let's log the original size
                print(f"Processing image of size: {image.size}")
                
                # Generate SigLIP2 image embedding
                siglip_start = time.time()
                inputs = self.siglip_processor(
                    images=image,
                    return_tensors="pt"
                ).to(self.device)
                
                with torch.no_grad():
                    image_features = self.siglip_model.get_image_features(**inputs)
                    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                
                embeddings["siglip2"] = {
                    "embedding": image_features[0].cpu().numpy().tolist(),
                    "dimension": 768,
                    "processing_time": time.time() - siglip_start,
                    "model_type": "image"
                }
                
                # No Jina v3 for images (it's text-only)
                embeddings["jina_v3"] = None
                
            except Exception as e:
                print(f"Error processing image: {e}")
                return {"error": f"Failed to process image: {str(e)}"}
                
        elif text:
            # Process text input (original logic)
            # Generate SigLIP2 embedding for cross-modal search
            siglip_start = time.time()
            inputs = self.siglip_processor(
                text=[text],
                padding="max_length",
                max_length=64,
                truncation=True,
                return_tensors="pt"
            ).to(self.device)
            
            with torch.no_grad():
                text_features = self.siglip_model.get_text_features(**inputs)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            
            embeddings["siglip2"] = {
                "embedding": text_features[0].cpu().numpy().tolist(),
                "dimension": 768,
                "processing_time": time.time() - siglip_start,
                "model_type": "text"
            }
            
            # Generate Jina v3 embedding for text search
            jina_start = time.time()
            try:
                with torch.no_grad():
                    jina_embeddings = self.jina_model.encode(
                        [text],
                        task="retrieval.query",  # For search queries
                        truncate_dim=768  # Match SigLIP2 dimensions
                    )
                
                # Convert to list - Jina returns numpy array
                jina_embedding_list = jina_embeddings[0].tolist()
                
                embeddings["jina_v3"] = {
                    "embedding": jina_embedding_list,
                    "dimension": 768,
                    "processing_time": time.time() - jina_start,
                    "model_type": "text"
                }
            except Exception as e:
                print(f"Error generating Jina embedding: {e}")
                # Return empty embedding on error
                embeddings["jina_v3"] = {
                    "embedding": [0.0] * 768,
                    "dimension": 768,
                    "processing_time": time.time() - jina_start,
                    "error": str(e),
                    "model_type": "text"
                }
        else:
            return {"error": "No text or image provided"}
        
        return {
            "input_type": input_type,
            "text": text if text else None,
            "embeddings": embeddings,
            "total_processing_time": time.time() - overall_start,
            "device": self.device
        }

# Web endpoint that uses the class
@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def embed_text(request: dict) -> dict:
    """API endpoint for generating embeddings for text or images"""
    text = request.get("text", "").strip() if "text" in request else None
    image_base64 = request.get("image", "").strip() if "image" in request else None
    
    if not text and not image_base64:
        return {"error": "No text or image provided"}
    
    if text and image_base64:
        return {"error": "Please provide either text or image, not both"}
    
    try:
        # Get or create an instance of the model class
        model_instance = EmbeddingModel()
        # Call the embed method with appropriate parameter
        return model_instance.embed.remote(text=text, image_base64=image_base64)
    except Exception as e:
        return {"error": str(e)}

@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def health() -> dict:
    """Health check endpoint"""
    return {
        "status": "healthy",
        "models": {
            "siglip2": "Cross-modal text-to-image search (supports both text and image inputs)",
            "jina_v3": "Advanced text search (text only)"
        },
        "response_format": "Returns embeddings based on input type",
        "supported_inputs": {
            "text": "Plain text string for semantic search",
            "image": "Base64-encoded image (JPEG/PNG) for visual similarity search"
        }
    }