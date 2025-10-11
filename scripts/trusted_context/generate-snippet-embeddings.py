#!/usr/bin/env python3
"""
Generate Jina v3 embeddings for knowledge snippets.

Usage:
  python scripts/trusted_context/generate-snippet-embeddings.py \
    --input data/trusted_corpus/snippets/met_436105.jsonl \
    --output data/trusted_corpus/snippets/met_436105.embedded.jsonl

Defaults:
  model = jinaai/jina-embeddings-v3
  task  = retrieval.passage
  batch = 64
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable, List

import torch
from transformers import AutoModel

MODEL_ID = "jinaai/jina-embeddings-v3"
MODEL_TASK = "retrieval.passage"
TRUNCATE_DIM = 768


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate embeddings for snippet JSONL.")
    parser.add_argument("--input", required=True, help="Path to input snippets JSONL.")
    parser.add_argument(
        "--output",
        help="Output JSONL path (defaults to <input>.embedded.jsonl).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Batch size for embedding generation (default: 64).",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda", "mps"],
        help="Torch device to run the model on (default: cpu).",
    )
    return parser.parse_args()


def load_model(device: str) -> AutoModel:
    print(f"Loading {MODEL_ID} on {device}...")
    model = AutoModel.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        device_map=None if device != "mps" else None,
    )

    if device == "mps" and torch.backends.mps.is_available():
        model = model.to("mps")
    elif device == "cuda" and torch.cuda.is_available():
        model = model.to("cuda")
    elif device != "cpu":
        print(f"Warning: requested device '{device}' unavailable, falling back to CPU.")
    print("✓ Model loaded")
    return model


def iter_jsonl(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped:
                continue
            yield json.loads(stripped)


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False))
            fh.write("\n")


def chunk_records(records: List[dict], size: int) -> Iterable[List[dict]]:
    for idx in range(0, len(records), size):
        yield records[idx : idx + size]


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_path = (
        Path(args.output)
        if args.output
        else input_path.with_suffix(".embedded.jsonl")
    )

    snippets = list(iter_jsonl(input_path))
    print(f"Loaded {len(snippets)} snippets from {input_path}")

    model = load_model(args.device)

    embedded_records: List[dict] = []
    for batch_idx, batch in enumerate(chunk_records(snippets, args.batch_size), start=1):
        texts = [record.get("text", "") for record in batch]
        with torch.inference_mode():
            embeddings = model.encode(
                texts,
                task=MODEL_TASK,
                truncate_dim=TRUNCATE_DIM,
            )
        for record, vector in zip(batch, embeddings):
            record["embedding"] = vector.tolist()
            embedded_records.append(record)
        print(
            f"Embedded batch {batch_idx}: processed {len(embedded_records)}/{len(snippets)} snippets"
        )

    write_jsonl(output_path, embedded_records)
    print(f"✓ Wrote {len(embedded_records)} embedded snippets → {output_path}")


if __name__ == "__main__":
    main()
