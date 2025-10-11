#!/usr/bin/env tsx
/**
 * Embed capsule snippets using Gemini embeddings.
 */

import { loadEnvConfig } from '@next/env';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { embedJinaTextBatch, EMBEDDING_MODELS } from '../../lib/embeddings';

const projectDir = path.join(__dirname, '..', '..');
loadEnvConfig(projectDir);

interface SnippetRecord {
  text: string;
  embedding?: number[];
  [key: string]: unknown;
}

interface CliOptions {
  input: string;
  output: string;
  batchSize: number;
  task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    batchSize: Number.parseInt(process.env.SNIPPET_EMBED_BATCH || '16', 10),
    task: 'RETRIEVAL_DOCUMENT',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
        options.input = argv[++i];
        break;
      case '--output':
        options.output = argv[++i];
        break;
      case '--batch':
        options.batchSize = Number.parseInt(argv[++i], 10);
        break;
      case '--task':
        options.task = argv[++i] as CliOptions['task'];
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Ignoring unknown option: ${arg}`);
        }
    }
  }

  if (!options.input) {
    throw new Error('Missing required --input <snippets.jsonl>');
  }

  const resolved: CliOptions = {
    input: options.input,
    output:
      options.output || options.input.replace(/\.jsonl$/i, '.with_embeddings.jsonl'),
    batchSize: Math.max(1, options.batchSize || 16),
    task: options.task || 'RETRIEVAL_DOCUMENT',
  };

  return resolved;
}

async function readJsonl(filePath: string): Promise<SnippetRecord[]> {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectDir, filePath);

  const handle = await fs.open(absolute, 'r');
  const stream = handle.createReadStream();
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const records: SnippetRecord[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed));
  }

  await rl.close();
  await handle.close();
  return records;
}

async function writeJsonl(filePath: string, records: SnippetRecord[]): Promise<void> {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectDir, filePath);

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  await fs.writeFile(absolute, content, 'utf-8');
}

async function embedSnippets(records: SnippetRecord[], batchSize: number, _task: CliOptions['task']) {
  const dimension = EMBEDDING_MODELS.jina_text.dimension;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const texts = batch.map((record) => (record.text ?? '').toString());
    const { vectors } = await embedJinaTextBatch(texts);

    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, received ${vectors.length}`);
    }

    vectors.forEach((vector, index) => {
      batch[index].embedding = vector.values;
    });

    console.log(
      `Embedded snippets ${i + 1}-${Math.min(i + batch.length, records.length)} (${vectors[0]?.values.length ?? 0} dims)`
    );
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const records = await readJsonl(options.input);

    if (records.length === 0) {
      console.warn('No snippets found in input file.');
      return;
    }

    console.log(`Loaded ${records.length} snippets from ${options.input}`);

    await embedSnippets(records, options.batchSize, options.task);

    await writeJsonl(options.output, records);
    console.log(`Saved embedded snippets → ${options.output}`);
  } catch (error) {
    console.error('embed-snippets failed:', error);
    process.exit(1);
  }
}

void main();
