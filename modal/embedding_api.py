import modal

app = modal.App("museum-embeddings")

image = modal.Image.debian_slim().pip_install(
    "fastapi",  # Required for web endpoints
    "transformers>=4.44.0",
    "torch>=2.0.0",
    "accelerate>=0.25.0",
    "pillow>=10.0.0",
)

# Use a class to persist models between requests
@app.cls(
    image=image,
    gpu="t4",
    memory=8192,
    container_idle_timeout=300,  # Keep warm for 5 minutes
    concurrency_limit=10,  # Handle up to 10 concurrent requests
)
class EmbeddingModel:
    @modal.enter()
    def setup(self):
        """Load models once when container starts"""
        import torch
        from transformers import AutoModel, AutoProcessor
        import time
        
        start_time = time.time()
        print("Loading SigLIP2 model...")
        
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Load SigLIP2 once
        self.processor = AutoProcessor.from_pretrained("google/siglip2-base-patch16-224")
        self.model = AutoModel.from_pretrained(
            "google/siglip2-base-patch16-224",
            torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
        ).to(self.device).eval()
        
        print(f"Model loaded on {self.device} in {time.time() - start_time:.2f}s")
    
    @modal.method()
    def embed(self, text: str) -> dict:
        """Generate embedding for text"""
        import torch
        import time
        
        start_time = time.time()
        
        # Process text using pre-loaded model
        inputs = self.processor(
            text=[text],
            padding="max_length",
            max_length=64,
            truncation=True,
            return_tensors="pt"
        ).to(self.device)
        
        with torch.no_grad():
            text_features = self.model.get_text_features(**inputs)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        
        embedding = text_features[0].cpu().numpy().tolist()
        
        return {
            "text": text,
            "embedding": embedding,
            "dimension": len(embedding),
            "model": "siglip2",
            "processing_time": time.time() - start_time,
            "device": self.device
        }

# Web endpoint that uses the class
@app.function(image=image)
@modal.web_endpoint(method="POST")
def embed_text(request: dict) -> dict:
    """API endpoint"""
    text = request.get("text", "").strip()
    if not text:
        return {"error": "No text provided"}
    
    try:
        # Get or create an instance of the model class
        model_instance = EmbeddingModel()
        # Call the embed method
        return model_instance.embed.remote(text)
    except Exception as e:
        return {"error": str(e)}

@app.function(image=image)
@modal.web_endpoint(method="GET")
def health() -> dict:
    """Health check endpoint"""
    return {"status": "healthy", "model": "siglip2"}