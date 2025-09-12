# UMAP Projection Implementation Plan

## Overview
Generate 2D and 3D UMAP projections of artwork embeddings for interactive visualization. This preprocessing step enables fast, responsive embedding space exploration in the frontend.

## Implementation Steps

### 1. Create UMAP Generation Script
`scripts/met/9-generate-umap-projections-met.py`

```python
import numpy as np
import umap
import json
from pathlib import Path
import argparse
from tqdm import tqdm

# Configuration
EMBEDDING_CONFIGS = {
    'jina_v3': {
        'path': 'data/met/embeddings/jina_v3/embeddings.jsonl',
        'dimension': 768
    },
    'siglip2': {
        'path': 'data/met/embeddings/siglip2/embeddings.jsonl',
        'dimension': 768  # verify actual dimension
    }
}

UMAP_PARAMS = {
    'standard_2d': {
        'n_components': 2,
        'n_neighbors': 15,
        'min_dist': 0.1,
        'metric': 'cosine'
    },
    'tight_2d': {
        'n_components': 2,
        'n_neighbors': 30,
        'min_dist': 0.01,
        'metric': 'cosine'
    },
    'loose_2d': {
        'n_components': 2,
        'n_neighbors': 10,
        'min_dist': 0.5,
        'metric': 'cosine'
    },
    'standard_3d': {
        'n_components': 3,
        'n_neighbors': 15,
        'min_dist': 0.1,
        'metric': 'cosine'
    }
}
```

### 2. Output Format
Store projections in JSONL format with metadata:

```json
{
  "artwork_id": "met_12345",
  "embedding_type": "jina_v3",
  "projection_type": "standard_2d",
  "coordinates": [0.123, -0.456],
  "metadata": {
    "title": "Portrait of a Lady",
    "artist": "Rembrandt",
    "date": "1632",
    "tags": ["Portraits", "Women"],
    "primaryImageSmall": "https://..."
  }
}
```

### 3. Directory Structure
```
data/met/projections/
├── jina_v3/
│   ├── standard_2d.jsonl
│   ├── tight_2d.jsonl
│   ├── loose_2d.jsonl
│   └── standard_3d.jsonl
├── siglip2/
│   ├── standard_2d.jsonl
│   ├── tight_2d.jsonl
│   ├── loose_2d.jsonl
│   └── standard_3d.jsonl
└── hybrid/
    ├── standard_2d.jsonl
    └── standard_3d.jsonl
```

### 4. Hybrid Embeddings
Create combined embeddings using both visual and textual features:

```python
def create_hybrid_embedding(jina_emb, siglip_emb, weight=0.5):
    """Combine text and image embeddings with weighting"""
    # Normalize embeddings
    jina_norm = jina_emb / np.linalg.norm(jina_emb)
    siglip_norm = siglip_emb / np.linalg.norm(siglip_emb)
    
    # Weighted combination
    hybrid = weight * jina_norm + (1 - weight) * siglip_norm
    return hybrid / np.linalg.norm(hybrid)
```

### 5. Optimization Strategies

#### Batch Processing
- Load embeddings in chunks to manage memory
- Process 10,000 artworks at a time
- Save intermediate results

#### Parallelization
- Use joblib for parallel UMAP fitting
- Generate different projection types concurrently
- Utilize all CPU cores

#### Incremental Updates
- Check existing projections
- Only process new artworks
- Append to existing JSONL files

### 6. Quality Assurance

#### Validation Metrics
- Preservation of local structure (nearest neighbors)
- Preservation of global structure (cluster separation)
- Coverage of projection space (no extreme outliers)

#### Visualization Tests
- Generate sample plots for each projection
- Verify cluster coherence
- Check for artifacts or distortions

### 7. Additional Preprocessing

#### Similarity Indices
```python
# Build Annoy index for fast nearest neighbor queries
from annoy import AnnoyIndex

def build_similarity_index(embeddings, n_trees=10):
    index = AnnoyIndex(embedding_dim, 'angular')
    for i, emb in enumerate(embeddings):
        index.add_item(i, emb)
    index.build(n_trees)
    return index
```

#### Cluster Analysis
```python
# Run HDBSCAN clustering
import hdbscan

def cluster_embeddings(projections):
    clusterer = hdbscan.HDBSCAN(min_cluster_size=10)
    cluster_labels = clusterer.fit_predict(projections)
    return cluster_labels
```

### 8. Frontend Integration

#### Data Loading Strategy
1. Load projection metadata on initial page load
2. Implement viewport-based loading for large datasets
3. Use Web Workers for data processing

#### Visualization Libraries
- **2D Plots**: D3.js with canvas rendering for performance
- **3D Plots**: Three.js with instanced rendering
- **Interactions**: Hammer.js for touch gestures

### 9. Script Execution Plan

```bash
# 1. Generate all projections
python scripts/met/9-generate-umap-projections-met.py --embedding-type all --projection-type all

# 2. Generate similarity indices
python scripts/met/10-build-similarity-indices-met.py --embedding-type all

# 3. Run clustering analysis
python scripts/met/11-cluster-embeddings-met.py --projection-type standard_2d

# 4. Create visualization samples
python scripts/met/12-generate-projection-previews-met.py
```

### 10. Performance Targets

- **Projection Generation**: < 5 minutes for 50,000 artworks
- **Frontend Loading**: < 2 seconds for initial view
- **Interaction Response**: < 100ms for pan/zoom
- **Search Response**: < 50ms for nearest neighbor queries

### 11. Future Enhancements

1. **Dynamic Projections**: Real-time UMAP for user-selected subsets
2. **Temporal Projections**: Separate projections by time period
3. **Hierarchical Projections**: Multi-resolution for smooth zooming
4. **Custom Metrics**: User-defined distance functions
5. **GPU Acceleration**: RAPIDS cuML for faster processing

### 12. Testing Strategy

1. **Unit Tests**: Projection quality metrics
2. **Integration Tests**: Frontend data loading
3. **Performance Tests**: Large dataset handling
4. **User Tests**: Interaction responsiveness
5. **A/B Tests**: Different projection parameters

## Next Steps

1. Install required dependencies: `umap-learn`, `annoy`, `hdbscan`
2. Create the projection generation script
3. Run initial projections on a subset for testing
4. Build frontend prototype with basic 2D visualization
5. Iterate based on visual quality and performance