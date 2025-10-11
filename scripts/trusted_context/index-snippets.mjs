#!/usr/bin/env node
/**
 * Bulk index capsule snippets into Elasticsearch.
 *
 * Examples:
 *   node scripts/trusted_context/index-snippets.mjs --artifact met_436105
 *   node scripts/trusted_context/index-snippets.mjs --snippets data/trusted_corpus/snippets/met_436105.jsonl --recreate
 */

import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import readline from 'readline';
import { Client } from '@elastic/elasticsearch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadEnvFiles() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.join(ROOT_DIR, file);
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    } catch {
      // ignore missing env file
    }
  }
}

loadEnvFiles();

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    snippets: [],
    recreate: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--snippets':
        if (!args[i + 1]) throw new Error('Missing value for --snippets');
        config.snippets.push(args[++i]);
        break;
      case '--artifact':
        if (!args[i + 1]) throw new Error('Missing value for --artifact');
        {
          const artifactId = args[++i];
          config.snippets.push(path.join('data', 'trusted_corpus', 'snippets', `${artifactId}.jsonl`));
        }
        break;
      case '--index':
        if (!args[i + 1]) throw new Error('Missing value for --index');
        config.index = args[++i];
        break;
      case '--recreate':
        config.recreate = true;
        break;
      default:
        console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  if (config.snippets.length === 0) {
    throw new Error('Provide at least one --snippets file or an --artifact id.');
  }

  return config;
}

function getClient() {
  const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const API_KEY = process.env.ELASTICSEARCH_API_KEY;
  const CLOUD_ID = process.env.ELASTICSEARCH_CLOUD_ID;

  if (CLOUD_ID && API_KEY) {
    return new Client({
      cloud: { id: CLOUD_ID },
      auth: { apiKey: API_KEY },
    });
  }

  if (API_KEY && (ES_URL.includes('elastic.co') || ES_URL.includes('elastic-cloud.com'))) {
    return new Client({
      node: ES_URL,
      auth: { apiKey: API_KEY },
    });
  }

  return new Client({ node: ES_URL });
}

const KNOWLEDGE_INDEX =
  process.env.ELASTICSEARCH_KNOWLEDGE_INDEX || 'knowledge_snippets';

const TEXT_EMBED_DIM =
  Number.parseInt(process.env.JINA_TEXT_EMBED_DIM || '1024', 10) || 1024;

const KNOWLEDGE_MAPPING = {
  settings: {
    analysis: {
      analyzer: {
        text_shingle: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'shingle'],
        },
      },
    },
  },
  mappings: {
    properties: {
      artifact_id: { type: 'keyword' },
      capsule_family: { type: 'keyword' },
      doc_id: { type: 'keyword' },
      snippet_id: { type: 'keyword' },
      source_title: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      source_type: { type: 'keyword' },
      source_url: { type: 'keyword' },
      source_retrieved: { type: 'date', format: 'date_optional_time' },
      source_license: { type: 'keyword' },
      source_note: { type: 'text' },
      section_heading: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
      text: { type: 'text', analyzer: 'standard', fields: { shingle: { type: 'text', analyzer: 'text_shingle' } } },
      word_count: { type: 'integer' },
      char_start: { type: 'integer' },
      char_end: { type: 'integer' },
      sentence_count: { type: 'integer' },
      entity_ids: { type: 'keyword' },
      doc_path: { type: 'keyword' },
      embedding: { type: 'dense_vector', dims: TEXT_EMBED_DIM, similarity: 'cosine' },
    },
  },
};

async function ensureIndex(client, indexName, recreate) {
  console.log(
    `Ensuring index '${indexName}' (embedding dims=${TEXT_EMBED_DIM})...`
  );
  const exists = await client.indices.exists({ index: indexName });
  if (exists && recreate) {
    console.log(`Deleting existing index '${indexName}'...`);
    await client.indices.delete({ index: indexName });
  }

  if (!exists || recreate) {
    console.log(`Creating index '${indexName}'...`);
    await client.indices.create({ index: indexName, body: KNOWLEDGE_MAPPING });
  } else {
    console.log(`Index '${indexName}' already exists.`);
  }
}

async function* readJsonl(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  const fileHandle = await fs.open(resolved, 'r');
  const stream = fileHandle.createReadStream();
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  } finally {
    rl.close();
    await fileHandle.close();
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSnippetPath(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);

  if (await fileExists(absolute)) {
    return absolute;
  }

  if (absolute.toLowerCase().endsWith('.jsonl')) {
    const withEmbeddings = absolute.replace(/\.jsonl$/i, '.with_embeddings.jsonl');
    if (await fileExists(withEmbeddings)) {
      return withEmbeddings;
    }
  }

  throw new Error(`Snippet file not found: ${filePath}`);
}

async function bulkIndex(client, indexName, filePath) {
  let count = 0;
  const ops = [];
  const displayPath = path.relative(ROOT_DIR, path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath));

  for await (const doc of readJsonl(filePath)) {
    ops.push({ index: { _index: indexName, _id: doc.snippet_id } });
    if (doc.embedding && Array.isArray(doc.embedding)) {
      doc.embedding = doc.embedding.map((v) => (typeof v === 'number' ? v : 0));
    }
    if (doc.source_retrieved && typeof doc.source_retrieved === 'string' && !doc.source_retrieved.includes('T')) {
      doc.source_retrieved = `${doc.source_retrieved}T00:00:00Z`;
    }
    ops.push(doc);
    count += 1;
  }

  if (ops.length === 0) {
    console.warn(`No documents found in ${filePath}`);
    return 0;
  }

  const result = await client.bulk({ refresh: true, body: ops });
  if (result.errors) {
    const firstError = result.items.find((item) => item.index && item.index.error);
    console.error('Bulk indexing reported errors.', firstError?.index?.error);
    throw new Error('Bulk indexing failed. See logs above.');
  }

  console.log(`Indexed ${count} snippets from ${displayPath}`);
  return count;
}

async function main() {
  const args = parseArgs();
  const client = getClient();
  const indexName = args.index || KNOWLEDGE_INDEX;

  await ensureIndex(client, indexName, args.recreate);

  let total = 0;
  for (const filePath of args.snippets) {
    const resolvedPath = await resolveSnippetPath(filePath);
    total += await bulkIndex(client, indexName, resolvedPath);
  }

  console.log(`Indexed total of ${total} snippets into '${indexName}'.`);
}

main().catch((error) => {
  console.error('index-snippets.mjs failed:', error);
  process.exit(1);
});
