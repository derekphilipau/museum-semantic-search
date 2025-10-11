#!/usr/bin/env node
/**
 * Generate embeddings for capsule snippets and write an augmented JSONL file.
 *
 * Usage:
 *   node scripts/trusted_context/embed-snippets.mjs --input data/trusted_corpus/snippets/met_436105.jsonl
 *   node scripts_trusted_context/embed-snippets.mjs --input ... --output ...
 *
 * Requires:
 *   - HUGGINGFACE_API_TOKEN (or HF_ACCESS_TOKEN) with access to jinaai/jina-embeddings-v3
 */

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

loadEnvFiles();

const HF_TOKEN =
  process.env.HUGGINGFACE_API_TOKEN ||
  process.env.HF_ACCESS_TOKEN ||
  process.env.HUGGINGFACEHUB_API_TOKEN;

if (!HF_TOKEN) {
  console.error('Missing HUGGINGFACE_API_TOKEN (or HF_ACCESS_TOKEN). Set it in .env/.env.local.');
  process.exit(1);
}

const MODEL_ID = process.env.SNIPPET_EMBED_MODEL || 'jinaai/jina-embeddings-v3';
const MODEL_TASK = process.env.SNIPPET_EMBED_TASK || 'retrieval.passage';
const BATCH_SIZE = Number(process.env.SNIPPET_EMBED_BATCH || 8);

function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const fullPath = path.join(ROOT_DIR, file);
    try {
      const raw = _readFileSync(fullPath);
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    } catch {
      // ignore missing file
    }
  }
}

function _readFileSync(filePath) {
  try {
    return require('fs').readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--input':
        config.input = args[++i];
        break;
      case '--output':
        config.output = args[++i];
        break;
      case '--batch':
        config.batch = Number.parseInt(args[++i], 10);
        break;
      default:
        console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  if (!config.input) {
    throw new Error('Missing required --input <snippets.jsonl>');
  }

  return {
    input: config.input,
    output:
      config.output ||
      config.input.replace(/\.jsonl$/, '.with_embeddings.jsonl'),
    batchSize: config.batch || BATCH_SIZE,
  };
}

async function* readJsonl(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  const handle = await fs.open(resolved, 'r');
  const stream = handle.createReadStream();
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  } finally {
    rl.close();
    await handle.close();
  }
}

async function embedBatch(texts) {
  const response = await fetch(
    `https://api-inference.huggingface.co/models/${MODEL_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: texts,
        options: { wait_for_model: true },
        parameters: { task: MODEL_TASK },
      }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Embedding request failed: ${response.status} ${response.statusText} - ${errBody}`
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected embedding response format: ${JSON.stringify(data)}`);
  }
  return data.map((row) => Array.isArray(row) ? row : row[0]);
}

async function main() {
  try {
    const args = parseArgs();
    const inputPath = path.isAbsolute(args.input) ? args.input : path.join(ROOT_DIR, args.input);
    const outputPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT_DIR, args.output);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const snippets = [];
    for await (const doc of readJsonl(inputPath)) {
      snippets.push(doc);
    }

    console.log(`Loaded ${snippets.length} snippets from ${inputPath}`);
    const writeHandle = await fs.open(outputPath, 'w');

    try {
      for (let i = 0; i < snippets.length; i += args.batchSize) {
        const batch = snippets.slice(i, i + args.batchSize);
        const texts = batch.map((doc) => doc.text || '');
        const embeddings = await embedBatch(texts);

        batch.forEach((doc, idx) => {
          doc.embedding = embeddings[idx];
        });

        const lines = batch.map((doc) => JSON.stringify(doc));
        await writeHandle.write(`${lines.join('\n')}\n`);
        console.log(
          `Embedded snippets ${i + 1}-${Math.min(i + args.batchSize, snippets.length)}`
        );
      }
    } finally {
      await writeHandle.close();
    }

    console.log(`Saved ${snippets.length} embedded snippets → ${path.relative(ROOT_DIR, outputPath)}`);
  } catch (error) {
    console.error('embed-snippets.mjs failed:', error);
    process.exit(1);
  }
}

main();
