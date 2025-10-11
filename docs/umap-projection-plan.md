# UMAP Projection Implementation Plan

## Overview
Generate 2D and 3D UMAP projections of artwork embeddings for interactive visualization using the TypeScript CLI `scripts/met/generate-umap-projections.ts`. The script relies on [`umap-js`](https://github.com/PAIR-code/umap-js) and operates on the Jina text and Jina CLIP embedding JSONL files.

## Embedding Inputs
```
data/met/embeddings/
├── jina_text/embeddings.jsonl
└── jina_clip/embeddings.jsonl
```
Each line in the JSONL files contains `{ "artwork_id": string, "embedding": number[] }`.

## Projection Configurations
The CLI builds four projections per embedding family:

| Projection        | Components | Neighbors | Min Dist |
| ----------------- | ---------- | --------- | -------- |
| `standard_2d`     | 2          | 15        | 0.10     |
| `tight_2d`        | 2          | 30        | 0.01     |
| `loose_2d`        | 2          | 10        | 0.60     |
| `standard_3d`     | 3          | 15        | 0.10     |

These defaults mirror the earlier Python implementation while keeping the code entirely in TypeScript.

## Output Format
The script writes one JSONL file per projection type:

```
data/met/projections/<embedding_type>/<projection_type>.jsonl
```
Each line contains:

```json
{
  "artwork_id": "met_12345",
  "embedding_type": "jina_text",
  "projection_type": "standard_2d",
  "coordinates": [0.123, -0.456],
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

## Usage
```bash
npx tsx scripts/met/generate-umap-projections.ts \
  --types jina_text,jina_clip
```

Optional flags:
- `--limit <n>`: project only the first *n* embeddings (useful for smoke tests).
- `--types <list>`: comma-separated embedding keys (defaults to both).

## Future Enhancements
- Add hybrid projections that blend text + image vectors prior to UMAP.
- Cache k-NN graphs for faster incremental updates.
- Persist thumbnails/metadata alongside coordinates for offline tooling.
