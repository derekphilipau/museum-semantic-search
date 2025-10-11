#!/usr/bin/env tsx

import { loadEnvConfig } from '@next/env';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { UMAP } from 'umap-js';

const projectDir = path.join(__dirname, '..', '..');
loadEnvConfig(projectDir);

const DATA_DIR = path.join(projectDir, 'data', 'met');
const EMBEDDINGS_DIR = path.join(DATA_DIR, 'embeddings');
const OUTPUT_DIR = path.join(DATA_DIR, 'projections');

interface EmbeddingRecord {
  artwork_id: string;
  embedding: number[];
}

interface ProjectionPoint {
  artwork_id: string;
  embedding_type: string;
  projection_type: string;
  coordinates: number[];
  timestamp: string;
}

interface CliOptions {
  embeddingTypes: string[];
  limit?: number;
}

const PROJECTION_CONFIGS: Record<string, { nComponents: 2 | 3; nNeighbors: number; minDist: number }> = {
  standard_2d: { nComponents: 2, nNeighbors: 15, minDist: 0.1 },
  tight_2d: { nComponents: 2, nNeighbors: 30, minDist: 0.01 },
  loose_2d: { nComponents: 2, nNeighbors: 10, minDist: 0.6 },
  standard_3d: { nComponents: 3, nNeighbors: 15, minDist: 0.1 },
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    embeddingTypes: ['jina_text', 'jina_clip'],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--types':
        options.embeddingTypes = argv[++i]
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case '--limit':
        options.limit = Number.parseInt(argv[++i], 10);
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Ignoring unknown option ${arg}`);
        }
    }
  }

  return options;
}

async function loadEmbeddings(
  embeddingType: string,
  limit?: number
): Promise<EmbeddingRecord[]> {
  const filePath = path.join(EMBEDDINGS_DIR, embeddingType, 'embeddings.jsonl');

  try {
    await fs.access(filePath);
  } catch {
    console.warn(`Embedding file not found for ${embeddingType}`);
    return [];
  }

  const records: EmbeddingRecord[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (limit && records.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as EmbeddingRecord;
      if (record.artwork_id && Array.isArray(record.embedding)) {
        records.push(record);
      }
    } catch {
      console.warn('Failed to parse embedding record');
    }
  }

  return records;
}

async function writeProjectionFile(
  embeddingType: string,
  projectionType: string,
  points: ProjectionPoint[]
) {
  const dir = path.join(OUTPUT_DIR, embeddingType);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${projectionType}.jsonl`);
  const writer = createWriteStream(filePath, { flags: 'w' });
  points.forEach((point) => {
    writer.write(`${JSON.stringify(point)}\n`);
  });
  writer.end();
  console.log(`  Saved ${projectionType} → ${filePath}`);
}

async function generateProjectionsForEmbedding(
  embeddingType: string,
  records: EmbeddingRecord[]
) {
  if (records.length === 0) {
    console.log(`No embeddings for ${embeddingType}, skipping.`);
    return;
  }

  const data = records.map((record) => record.embedding);

  for (const [projectionType, config] of Object.entries(PROJECTION_CONFIGS)) {
    console.log(
      `  Computing ${projectionType} for ${embeddingType} (n=${records.length})...`
    );

    const umap = new UMAP({
      nComponents: config.nComponents,
      nNeighbors: config.nNeighbors,
      minDist: config.minDist,
    });
    const coordinates = umap.fit(data);

    const timestamp = new Date().toISOString();
    const points: ProjectionPoint[] = coordinates.map((coords, index) => ({
      artwork_id: records[index].artwork_id,
      embedding_type: embeddingType,
      projection_type: projectionType,
      coordinates: Array.from(coords),
      timestamp,
    }));

    await writeProjectionFile(embeddingType, projectionType, points);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    for (const embeddingType of options.embeddingTypes) {
      console.log(`Processing embeddings for ${embeddingType}...`);
      const records = await loadEmbeddings(embeddingType, options.limit);
      if (!records.length) {
        continue;
      }
      await generateProjectionsForEmbedding(embeddingType, records);
    }

    console.log('Projection generation complete.');
  } catch (error) {
    console.error('generate-umap-projections failed:', error);
    process.exit(1);
  }
}

void main();
