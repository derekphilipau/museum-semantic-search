#!/usr/bin/env node
/**
 * Build an offline knowledge capsule for a museum artwork.
 *
 * Usage:
 *   node scripts/trusted_context/build-capsule.mjs --artifact-config data/trusted_corpus/artifacts/met_436105.json
 *
 * Generates:
 *   - data/trusted_corpus/capsules/<artifact_id>.json
 *   - data/trusted_corpus/snippets/<artifact_id>.jsonl
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data', 'trusted_corpus');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const CAPSULE_DIR = path.join(DATA_DIR, 'capsules');
const SNIPPET_DIR = path.join(DATA_DIR, 'snippets');

const DEFAULT_VISUAL_DESCRIPTIONS = path.join(
  ROOT_DIR,
  'data',
  'met',
  'descriptions',
  'gemini_2_5_flash',
  'edited_descriptions.jsonl'
);

const DEFAULT_MAX_WORDS = 170;
const DEFAULT_MIN_WORDS = 55;
const VISUAL_MAX_WORDS = 120;
const VISUAL_MIN_WORDS = 40;

const SENTENCE_REGEX = /[^.!?]+(?:[.!?]+|$)/g;

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    maxWords: DEFAULT_MAX_WORDS,
    minWords: DEFAULT_MIN_WORDS,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--artifact-config':
        config.artifactConfig = args[++i];
        break;
      case '--output-capsule':
        config.outputCapsule = args[++i];
        break;
      case '--output-snippets':
        config.outputSnippets = args[++i];
        break;
      case '--max-words':
        config.maxWords = Number.parseInt(args[++i], 10);
        break;
      case '--min-words':
        config.minWords = Number.parseInt(args[++i], 10);
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      default:
        console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  if (!config.artifactConfig) {
    throw new Error('Missing required --artifact-config argument');
  }

  return config;
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function loadArtifactConfig(configPath) {
  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.join(ROOT_DIR, configPath);
  return loadJson(resolved);
}

async function computeSha256(filePath) {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function iterSentenceSpans(text) {
  const spans = [];
  if (!text || !text.trim()) return spans;

  let match;
  while ((match = SENTENCE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const leadingWhitespace = raw.length - raw.trimStart().length;
    const trailingWhitespace = raw.length - raw.trimEnd().length;
    const start = match.index + leadingWhitespace;
    const end = match.index + raw.length - trailingWhitespace;

    spans.push({
      text: text.slice(start, end),
      start,
      end,
    });
  }
  return spans;
}

function chunkSentences(spans, maxWords, minWords) {
  const chunks = [];
  const current = [];
  let wordTotal = 0;

  const flush = (force = false) => {
    if (current.length === 0) return;
    if (!force && wordTotal < minWords) return;

    const text = current.map((span) => span.text.trim()).join(' ').trim();
    const words = text ? text.split(/\s+/).length : 0;
    chunks.push({
      text,
      word_count: words,
      char_start: current[0].start,
      char_end: current[current.length - 1].end,
      sentence_count: current.length,
    });
    current.length = 0;
    wordTotal = 0;
  };

  for (const span of spans) {
    const spanWords = span.text.trim() ? span.text.trim().split(/\s+/).length : 0;
    if (current.length === 0) {
      current.push(span);
      wordTotal = spanWords;
      continue;
    }

    if (wordTotal + spanWords <= maxWords) {
      current.push(span);
      wordTotal += spanWords;
    } else {
      flush(true);
      current.push(span);
      wordTotal = spanWords;
      if (spanWords >= maxWords) {
        flush(true);
      }
    }
  }

  flush(true);
  return chunks;
}

function buildVisualDescriptionChunks(longDescription) {
  const spans = iterSentenceSpans(longDescription ?? '');
  return chunkSentences(spans, VISUAL_MAX_WORDS, VISUAL_MIN_WORDS);
}

async function loadVisualDescription(artifactId, source) {
  const filePath = source?.path ?? DEFAULT_VISUAL_DESCRIPTIONS;
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  const artworkKey = source?.artwork_id_field ?? 'artwork_id';
  const altKey = source?.alt_text_field ?? 'alt_text';
  const longKey = source?.field ?? 'long_description';
  const emojiKey = source?.emoji_field ?? 'emoji_summary';

  const file = await fs.readFile(resolved, 'utf-8');
  for (const line of file.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record[artworkKey] === artifactId) {
      return {
        alt_text: record[altKey],
        long_description: record[longKey],
        emoji_summary: record[emojiKey],
      };
    }
  }
  throw new Error(`No visual description found for ${artifactId} in ${resolved}`);
}

async function processDocument(artifactId, docConfig, maxWords, minWords) {
  const rawPath = path.join(RAW_DIR, docConfig.path);
  const rawDoc = await loadJson(rawPath);
  const sections = rawDoc.sections ?? [];
  const snippets = [];
  const snippetIds = [];

  sections.forEach((section, sectionIndex) => {
    const spans = iterSentenceSpans(section.text ?? '');
    const chunks = chunkSentences(spans, maxWords, minWords);
    chunks.forEach((chunk, chunkIndex) => {
      const snippetId = `${docConfig.doc_id}:${sectionIndex}:${chunkIndex}`;
      snippets.push({
        artifact_id: artifactId,
        capsule_family: docConfig.capsule_family ?? rawDoc.capsule_family ?? 'subject',
        doc_id: docConfig.doc_id,
        snippet_id: snippetId,
        source_title: rawDoc.title,
        source_type: rawDoc.source?.type,
        source_url: rawDoc.source?.url,
        source_retrieved: rawDoc.source?.retrieved,
        source_license: rawDoc.source?.license,
        source_note: rawDoc.source?.note,
        section_heading: section.heading ?? null,
        section_index: sectionIndex,
        chunk_index: chunkIndex,
        text: chunk.text,
        word_count: chunk.word_count,
        char_start: chunk.char_start,
        char_end: chunk.char_end,
        sentence_count: chunk.sentence_count,
        entity_ids: rawDoc.entity_ids ?? [],
        doc_path: docConfig.path,
      });
      snippetIds.push(snippetId);
    });
  });

  const summary = {
    doc_id: docConfig.doc_id,
    capsule_family: docConfig.capsule_family ?? rawDoc.capsule_family ?? 'subject',
    source_title: rawDoc.title,
    source_type: rawDoc.source?.type,
    source_url: rawDoc.source?.url,
    source_retrieved: rawDoc.source?.retrieved,
    source_license: rawDoc.source?.license,
    entity_ids: rawDoc.entity_ids ?? [],
    section_count: sections.length,
    snippet_ids: snippetIds,
    source_hash: await computeSha256(rawPath),
  };

  return { snippets, summary };
}

function countBy(items, key) {
  const counts = new Map();
  items.forEach((item) => {
    const value = item[key] ?? 'unknown';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Object.fromEntries(counts.entries());
}

async function main() {
  try {
    const args = parseArgs();
    const artifactConfig = await loadArtifactConfig(String(args.artifactConfig));
    const artifactId = artifactConfig.artifact_id;

    const snippets = [];
    const documents = [];

    for (const docConfig of artifactConfig.documents ?? []) {
      const { snippets: docSnippets, summary } = await processDocument(
        artifactId,
        docConfig,
        Number(args.maxWords),
        Number(args.minWords)
      );
      snippets.push(...docSnippets);
      documents.push(summary);
    }

    const visualDescription = await loadVisualDescription(
      artifactId,
      artifactConfig.visual_description_source
    );

    const capsule = {
      artifact_id: artifactId,
      title: artifactConfig.title,
      wikidata_id: artifactConfig.wikidata_id,
      object_id: artifactConfig.object_id,
      accession_number: artifactConfig.accession_number,
      core_facts: {
        artist: artifactConfig.artist,
        object_date: artifactConfig.object_date,
        medium: artifactConfig.medium,
        dimensions: artifactConfig.dimensions,
        department: artifactConfig.department,
        object_name: artifactConfig.object_name,
        repository: artifactConfig.repository,
        met_url: artifactConfig.met_url,
      },
      related_entities: artifactConfig.related_entities ?? [],
      documents,
      visual_description: {
        alt_text: visualDescription.alt_text,
        emoji_summary: visualDescription.emoji_summary,
        long_description: visualDescription.long_description,
        chunks: buildVisualDescriptionChunks(visualDescription.long_description).map(
          (chunk, index) => ({
            chunk_id: `vd:${index}`,
            ...chunk,
          })
        ),
      },
      sections: {
        summary: [],
        timeline: [],
        glossary: [],
      },
      snippet_stats: {
        total_snippets: snippets.length,
        by_family: countBy(snippets, 'capsule_family'),
        by_source: countBy(snippets, 'source_type'),
      },
      build: {
        generated_at: new Date().toISOString(),
        script: 'scripts/trusted_context/build-capsule.mjs',
        version: '0.1.0',
        source_hashes: Object.fromEntries(
          documents
            .filter((doc) => typeof doc.source_hash === 'string')
            .map((doc) => [doc.doc_id, doc.source_hash])
        ),
      },
    };

    const capsulePath = args.outputCapsule
      ? path.isAbsolute(args.outputCapsule)
        ? args.outputCapsule
        : path.join(ROOT_DIR, args.outputCapsule)
      : path.join(CAPSULE_DIR, `${artifactId}.json`);

    const snippetsPath = args.outputSnippets
      ? path.isAbsolute(args.outputSnippets)
        ? args.outputSnippets
        : path.join(ROOT_DIR, args.outputSnippets)
      : path.join(SNIPPET_DIR, `${artifactId}.jsonl`);

    if (args.dryRun) {
      console.log(JSON.stringify({ capsule, snippets }, null, 2));
      return;
    }

    await fs.mkdir(path.dirname(capsulePath), { recursive: true });
    await fs.mkdir(path.dirname(snippetsPath), { recursive: true });

    await fs.writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`, 'utf-8');

    const snippetLines = snippets.map((snippet) => JSON.stringify(snippet));
    await fs.writeFile(snippetsPath, `${snippetLines.join('\n')}\n`, 'utf-8');

    console.log(`Wrote capsule → ${path.relative(ROOT_DIR, capsulePath)}`);
    console.log(`Wrote snippets → ${path.relative(ROOT_DIR, snippetsPath)}`);
    console.log(`Total snippets: ${snippets.length}`);
  } catch (error) {
    console.error('build-capsule.mjs failed:', error);
    process.exit(1);
  }
}

main();
