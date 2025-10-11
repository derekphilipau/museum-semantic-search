#!/usr/bin/env node
/**
 * Generates "Similar Artworks" recommendations using a two‑stage pipeline:
 * 1. Gather trimmed candidate sets (metadata + text + image) and fuse them with RRF.
 * 2. Calls Gemini 2.5 Flash with bounded concurrency to pick and justify the best matches.
 *
 * The script writes JSONL to data/met/similar_artworks.jsonl. Each line contains:
 * {
 *   id: string;
 *   generated_at: string;
 *   model: string;
 *   prompt_version: string;
 *   similar_artworks: Array<{ id; similarity_type; confidence; reason }>;
 *   candidates: Array<{ id; fused_rank; fused_score; sources: [...] }>;
 *   errors?: string[];
 * }
 */

import { loadEnvConfig } from '@next/env';
import { parseArgs } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { setTimeout as delay } from 'node:timers/promises';
import {
  getElasticsearchClient,
  INDEX_NAME,
  findSimilarArtworks,
  findMetadataSimilarArtworks,
} from '../../lib/elasticsearch/client';
import type { Artwork, SearchHit, SearchResponse } from '../../app/types';
import type { Client } from '@elastic/elasticsearch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  EnhancedGenerateContentResponse,
  GenerateContentResult,
  GenerateContentCandidate,
  Part,
} from '@google/generative-ai';

// Load env vars before other imports use them
const projectDir = path.join(__dirname, '../..');
loadEnvConfig(projectDir);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_PATH = path.join(projectDir, 'data', 'met', 'similar_artworks.jsonl');

const DEFAULT_CONCURRENCY = 6;
const MAX_PROMPT_CANDIDATES = 28;
const PROMPT_VERSION = 'v2';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const CANDIDATE_LIMITS = {
  metadata: 20,
  jina_text: 20,
  jina_clip: 10,
} as const;

const SOURCE_WEIGHTS: Record<CandidateSourceType, number> = {
  metadata: 0.3,
  jina_text: 0.4,
  jina_clip: 0.3,
};

const RRF_K = 60;
const MAX_LLM_RESULTS = 12;
const MIN_CONFIDENCE = 0.2; // used only when we need to clamp invalid values

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1500;
const MAX_RESPONSE_RETRIES = 2;

const SIMILARITY_TYPE_HINT = [
  'style',
  'subject',
  'mood',
  'technique',
  'period',
  'composition',
  'material',
  'narrative',
  'iconography',
  'other',
];

type CandidateSourceType = 'metadata' | 'jina_text' | 'jina_clip';

interface CandidateEvidence {
  source: CandidateSourceType;
  rank: number;
  score: number;
  weight: number;
}

interface CandidateAggregate {
  id: string;
  title?: string;
  artist?: string;
  date?: string;
  medium?: string;
  classification?: string;
  department?: string;
  summary?: string;
  fusedScore: number;
  fusedRank: number;
  evidence: CandidateEvidence[];
}

interface PromptBundle {
  artworkId: string;
  source: SourceSummary;
  candidates: CandidateAggregate[];
}

interface SourceSummary {
  id: string;
  title?: string;
  artist?: string;
  date?: string;
  medium?: string;
  classification?: string;
  department?: string;
  summary?: string;
}

interface SimilarArtworkRecord {
  id: string;
  generated_at: string;
  model: string;
  prompt_version: string;
  similar_artworks: Array<{
    id: string;
    similarity_type: string;
    confidence: number;
    reason: string;
  }>;
  candidates: Array<{
    id: string;
    fused_rank: number;
    fused_score: number;
    sources: CandidateEvidence[];
  }>;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function truncate(text: string | undefined, max = 240): string | undefined {
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function cleanJsonCandidateText(raw: string): string {
  // Remove markdown fences if present
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```\w*\s*/, '').replace(/```$/, '');
    return withoutFence.trim();
  }
  return trimmed;
}

function extractJsonArray(raw: string): unknown {
  const cleaned = cleanJsonCandidateText(raw);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || start >= end) {
    throw new Error('Could not locate JSON array in model response');
  }
  const jsonString = cleaned.slice(start, end + 1);
  return JSON.parse(jsonString);
}

function normaliseConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < MIN_CONFIDENCE) return MIN_CONFIDENCE;
    if (value > 1) return 1;
    return value;
  }
  return 0.5;
}

// ---------------------------------------------------------------------------
// Elasticsearch helpers
// ---------------------------------------------------------------------------

async function getAllArtworkIds(esClient: Client): Promise<string[]> {
  const artworkIds: string[] = [];
  const response = await esClient.search({
    index: INDEX_NAME,
    scroll: '1m',
    size: 1000,
    _source: false,
    query: { match_all: {} },
  });

  let scrollId = response._scroll_id;
  let hits = response.hits.hits;

  while (hits.length > 0) {
    artworkIds.push(...hits.map((hit) => hit._id).filter((id): id is string => Boolean(id)));
    const scrollResponse = await esClient.scroll({
      scroll_id: scrollId!,
      scroll: '1m',
    });

    scrollId = scrollResponse._scroll_id;
    hits = scrollResponse.hits.hits;
  }

  if (scrollId) {
    await esClient.clearScroll({ scroll_id: scrollId });
  }

  artworkIds.sort();
  return artworkIds;
}

function summariseArtwork(source?: Artwork | SearchHit['_source']): SourceSummary {
  if (!source) {
    return { id: 'unknown' };
  }

  const summary =
    source.visual_description?.alt_text ??
    source.visual_description?.long_description ??
    source.visual_description?.emoji_summary;

  return {
    id: (source as Artwork).id || '',
    title: source.title,
    artist: source.artist,
    date: source.date,
    medium: source.medium,
    classification: source.classification,
    department: source.department,
    summary: truncate(summary),
  };
}

function attachCandidate(
  map: Map<string, CandidateAggregate>,
  source: CandidateSourceType,
  hit: SearchResponse['hits'][number],
  rank: number,
  weight: number,
): void {
  const { _id, _score, _source } = hit;
  if (!_id) return;

  const existing = map.get(_id);
  const evidence: CandidateEvidence = {
    source,
    rank,
    score: _score ?? 0,
    weight,
  };
  const fusedIncrement = weight / (RRF_K + rank + 1);

  if (existing) {
    existing.evidence.push(evidence);
    existing.fusedScore += fusedIncrement;
    return;
  }

  map.set(_id, {
    id: _id,
    title: _source?.title,
    artist: _source?.artist,
    date: _source?.date,
    medium: _source?.medium,
    classification: _source?.classification,
    department: _source?.department,
    summary: truncate(_source?.visual_description?.alt_text ?? _source?.visual_description?.long_description),
    fusedScore: fusedIncrement,
    fusedRank: 0, // assigned later
    evidence: [evidence],
  });
}

async function buildPromptBundle(
  artworkId: string,
): Promise<PromptBundle | null> {
  const esClient = getElasticsearchClient();

  const sourceResponse = await esClient.get({
    index: INDEX_NAME,
    id: artworkId,
  });

  const sourceArtwork = sourceResponse._source as Artwork | undefined;
  if (!sourceArtwork) {
    console.warn(`Skipping ${artworkId} – source artwork not found`);
    return null;
  }

  const [metadataResults, textResults, clipResults] = await Promise.all([
    findMetadataSimilarArtworks(artworkId, CANDIDATE_LIMITS.metadata),
    findSimilarArtworks(artworkId, 'jina_text', CANDIDATE_LIMITS.jina_text),
    findSimilarArtworks(artworkId, 'jina_clip', CANDIDATE_LIMITS.jina_clip),
  ]);

  const candidateMap = new Map<string, CandidateAggregate>();

  metadataResults.hits.forEach((hit, idx) => {
    attachCandidate(candidateMap, 'metadata', hit, idx, SOURCE_WEIGHTS.metadata);
  });
  textResults.hits.forEach((hit, idx) => {
    attachCandidate(candidateMap, 'jina_text', hit, idx, SOURCE_WEIGHTS.jina_text);
  });
  clipResults.hits.forEach((hit, idx) => {
    attachCandidate(candidateMap, 'jina_clip', hit, idx, SOURCE_WEIGHTS.jina_clip);
  });

  candidateMap.delete(artworkId);

  const aggregated = Array.from(candidateMap.values());
  if (aggregated.length === 0) {
    console.warn(`Skipping ${artworkId} – no candidates after aggregation`);
    return null;
  }

  aggregated.sort((a, b) => b.fusedScore - a.fusedScore);
  aggregated.forEach((candidate, idx) => {
    candidate.fusedRank = idx + 1;
  });

  const trimmed = aggregated.slice(0, MAX_PROMPT_CANDIDATES);

  return {
    artworkId,
    source: summariseArtwork(sourceArtwork),
    candidates: trimmed,
  };
}

function buildPromptText(bundle: PromptBundle): string {
  const lines: string[] = [];
  lines.push(
    'You are an art historian creating structured similarity recommendations for a museum chat assistant.',
    'Select up to 12 artworks from the candidate list that are most relevant to the source artwork.',
    'Use the evidence (retrieval sources and ranks) to ground your choices. Prefer candidates supported by multiple sources or high fused scores.',
    'Return ONLY JSON (no markdown, comments, or extra text).',
    '',
    'Each JSON object must contain:',
    '- id: string (artwork ID)',
    `- similarity_type: string (one of ${SIMILARITY_TYPE_HINT.join(', ')})`,
    '- confidence: number between 0 and 1',
    '- reason: concise explanation (max 35 words) referencing visual or contextual cues',
    '',
    `Return format: [{"id":"...","similarity_type":"style","confidence":0.82,"reason":"..."}]`,
    '',
    'Source Artwork:',
    `Title: ${bundle.source.title ?? 'Unknown'}`,
    `Artist: ${bundle.source.artist ?? 'Unknown'}`,
    `Date: ${bundle.source.date ?? 'Unknown'}`,
    `Medium: ${bundle.source.medium ?? 'Unknown'}`,
    `Classification: ${bundle.source.classification ?? 'Unknown'}`,
    `Department: ${bundle.source.department ?? 'Unknown'}`,
  );

  if (bundle.source.summary) {
    lines.push(`Summary: ${bundle.source.summary}`);
  }

  lines.push('', 'Candidates:');

  bundle.candidates.forEach((candidate, idx) => {
    const evidenceLines = candidate.evidence
      .map(
        (ev) =>
          `${ev.source} (rank=${ev.rank + 1}, score=${ev.score.toFixed(3)})`,
      )
      .join('; ');

    lines.push(
      `${idx + 1}. ID: ${candidate.id}`,
      `   Title: ${candidate.title ?? 'Unknown'}`,
      `   Artist: ${candidate.artist ?? 'Unknown'}`,
      `   Date: ${candidate.date ?? 'Unknown'}`,
      `   Medium: ${candidate.medium ?? 'Unknown'}`,
      `   Classification: ${candidate.classification ?? 'Unknown'}`,
      `   Department: ${candidate.department ?? 'Unknown'}`,
      `   Summary: ${candidate.summary ?? 'N/A'}`,
      `   Evidence: ${evidenceLines}`,
      `   FusedRank: ${candidate.fusedRank} (score=${candidate.fusedScore.toFixed(4)})`,
      '',
    );
  });

  lines.push(
    'Remember: respond with ONLY a JSON array. Choose at most 12 items. Explanations must cite visual or contextual overlap, not retrieval mechanics.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gemini calls with retry & throttling
// ---------------------------------------------------------------------------

type GenerativeModel = ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

const extractStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('status' in error && typeof (error as { status?: number }).status === 'number') {
    return (error as { status?: number }).status;
  }

  const cause = (error as { cause?: { status?: number } }).cause;
  if (cause && typeof cause.status === 'number') {
    return cause.status;
  }

  const details = (error as { errorDetails?: Array<{ status?: number | string }> }).errorDetails;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (detail && typeof detail.status === 'number') {
        return detail.status;
      }
      if (detail && typeof detail.status === 'string') {
        const parsed = Number(detail.status);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
  }

  return undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
};

async function generateContentWithRetry(
  modelClient: GenerativeModel,
  prompt: string,
  attempt = 1,
): Promise<EnhancedGenerateContentResponse> {
  try {
    const result: GenerateContentResult = await modelClient.generateContent(prompt);
    return result.response;
  } catch (error) {
    const status = extractStatusCode(error);
    const message = getErrorMessage(error);

    if (
      status !== undefined &&
      (status === 429 || status >= 500) &&
      attempt < MAX_RETRY_ATTEMPTS
    ) {
      const delayMs = RETRY_BASE_DELAY_MS * attempt;
      console.warn(
        `Gemini throttled (status ${status}). Retrying in ${delayMs} ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`,
      );
      await delay(delayMs);
      return generateContentWithRetry(modelClient, prompt, attempt + 1);
    }

    console.error(`Gemini request failed: ${message}`);
    throw error;
  }
}

function parseGeminiResponse(rawResponse: EnhancedGenerateContentResponse): {
  items: SimilarArtworkRecord['similar_artworks'];
  errors: string[];
  shouldRetry: boolean;
} {
  const errors: string[] = [];
  let shouldRetry = false;
  const candidates = rawResponse?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push('no_candidates_returned');
    shouldRetry = true;
    return { items: [], errors, shouldRetry };
  }

  const first = candidates[0] as GenerateContentCandidate;
  if (first.finishReason === 'SAFETY') {
    errors.push('safety_block');
    return { items: [], errors, shouldRetry };
  }

  const textPart = first?.content?.parts?.find(
    (part: Part): part is Part & { text: string } => typeof part.text === 'string'
  );
  if (!textPart?.text) {
    errors.push('missing_text_part');
    shouldRetry = true;
    return { items: [], errors, shouldRetry };
  }

  try {
    const parsed = extractJsonArray(textPart.text);
    if (!Array.isArray(parsed)) {
      errors.push('parsed_not_array');
      shouldRetry = true;
      return { items: [], errors, shouldRetry };
    }

    const items: SimilarArtworkRecord['similar_artworks'] = [];

    for (const entry of parsed.slice(0, MAX_LLM_RESULTS)) {
      if (!entry || typeof entry !== 'object') continue;

      const id = typeof entry.id === 'string' ? entry.id.trim() : undefined;
      const reason =
        typeof entry.reason === 'string'
          ? entry.reason.trim()
          : typeof entry.explanation === 'string'
          ? entry.explanation.trim()
          : undefined;
      const similarityTypeRaw =
        typeof entry.similarity_type === 'string'
          ? entry.similarity_type
          : typeof entry.category === 'string'
          ? entry.category
          : 'other';

      if (!id || !reason) continue;

      const similarityType = SIMILARITY_TYPE_HINT.includes(similarityTypeRaw)
        ? similarityTypeRaw
        : 'other';

      items.push({
        id,
        similarity_type: similarityType,
        confidence: normaliseConfidence(entry.confidence),
        reason,
      });
    }

    if (items.length === 0) {
      shouldRetry = true;
    }

    return { items, errors, shouldRetry };
  } catch (parseError) {
    errors.push(`parse_error:${(parseError as Error).message}`);
    shouldRetry = true;
    return { items: [], errors, shouldRetry };
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function loadExistingRecords(filePath: string, force: boolean): Promise<Set<string>> {
  if (force) {
    try {
      await fs.unlink(filePath);
      console.log(`Removed existing output file at ${filePath}`);
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== 'ENOENT') {
        console.warn(`Failed to remove existing file: ${getErrorMessage(error)}`);
      }
    }
    return new Set();
  }

  const processed = new Set<string>();

  try {
    await fs.access(filePath);
  } catch {
    console.log('No existing output file found, starting fresh');
    return processed;
  }

  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as SimilarArtworkRecord;
      if (record?.id) {
        processed.add(record.id);
      }
    } catch (error) {
      console.warn('Failed to parse existing record:', error);
    }
  }

  console.log(`Loaded ${processed.size} previously generated records`);
  return processed;
}

async function appendRecords(filePath: string, records: SimilarArtworkRecord[]): Promise<void> {
  if (records.length === 0) return;
  const lines = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  await fs.appendFile(filePath, lines, 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', short: 'l' },
      'artwork-ids': { type: 'string' },
      'batch-size': { type: 'string' },
      model: { type: 'string' },
      force: { type: 'boolean', short: 'f' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
Generate LLM-curated similar artworks with Gemini (bounded concurrency).

Options:
  -l, --limit <n>         Process only the first n artworks after filtering
  --artwork-ids <ids>     Comma-separated list of specific artwork IDs to process
  --batch-size <n>        Concurrency level for Gemini calls (default ${DEFAULT_CONCURRENCY})
  --model <name>          Gemini model (default ${DEFAULT_MODEL})
  -f, --force             Delete previous output file and regenerate from scratch
  -h, --help              Show this help message

Example:
  npm run 6-generate-similar-artworks-met -- --limit 50 --batch-size 20
`);
    process.exit(0);
  }

  const apiKey =
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_TOKEN;
  if (!apiKey) {
    console.error('GOOGLE_GEMINI_API_KEY (or GEMINI_API_KEY) must be set');
    process.exit(1);
  }

  const model = values.model || DEFAULT_MODEL;
  const concurrency =
    values['batch-size'] !== undefined
      ? Math.max(1, parseInt(values['batch-size'], 10))
      : DEFAULT_CONCURRENCY;

  const force = Boolean(values.force);

  const processedIds = await loadExistingRecords(OUTPUT_PATH, force);

  const esClient = getElasticsearchClient();
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model });
  const allArtworkIds = values['artwork-ids']
    ? values['artwork-ids'].split(',').map((id: string) => id.trim())
    : await getAllArtworkIds(esClient);

  const remaining = allArtworkIds.filter((id) => !processedIds.has(id));

  const limit = values.limit ? Math.min(parseInt(values.limit, 10), remaining.length) : remaining.length;
  const toProcess = remaining.slice(0, limit);

  console.log(`\nTotal artworks: ${allArtworkIds.length}`);
  console.log(`Already processed: ${processedIds.size}`);
  console.log(`Remaining after resume filter: ${remaining.length}`);
  console.log(`Processing this run: ${toProcess.length}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Model: ${model}`);

  if (toProcess.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let completed = 0;
  let skipped = 0;

  const startTime = Date.now();

  for (const chunkIds of chunk(toProcess, concurrency)) {
    const bundles: PromptBundle[] = [];

    for (const artworkId of chunkIds) {
      try {
        const bundle = await buildPromptBundle(artworkId);
        if (bundle) {
          bundles.push(bundle);
        } else {
          skipped += 1;
        }
      } catch (error) {
        console.error(`Error building candidates for ${artworkId}:`, error);
        skipped += 1;
      }
    }

    if (bundles.length === 0) {
      continue;
    }

    const promptQueue = bundles.map((bundle) => ({
      bundle,
      prompt: buildPromptText(bundle),
      attempt: 1,
    }));

    const records: SimilarArtworkRecord[] = [];
    const successfulIds = new Set<string>();

    while (promptQueue.length > 0) {
      const current = promptQueue.shift();
      if (!current) break;
      const { bundle, prompt, attempt } = current;

      try {
        const response = await generateContentWithRetry(generativeModel, prompt);
        const { items, errors, shouldRetry } = parseGeminiResponse(response);

        if (shouldRetry && attempt < MAX_RESPONSE_RETRIES) {
          promptQueue.push({ bundle, prompt, attempt: attempt + 1 });
          continue;
        }

        if (shouldRetry) {
          console.warn(
            `Gemini returned unusable output for ${bundle.artworkId} after ${attempt} attempts; leaving unprocessed so it can be retried later.`,
          );
          skipped += 1;
          continue;
        }

        records.push({
          id: bundle.artworkId,
          generated_at: new Date().toISOString(),
          model,
          prompt_version: PROMPT_VERSION,
          similar_artworks: items,
          candidates: bundle.candidates.map((candidate) => ({
            id: candidate.id,
            fused_rank: candidate.fusedRank,
            fused_score: Number(candidate.fusedScore.toFixed(6)),
            sources: candidate.evidence,
          })),
          ...(errors.length > 0 ? { errors } : {}),
        });
        successfulIds.add(bundle.artworkId);
      } catch (error) {
        if (attempt < MAX_RESPONSE_RETRIES) {
          promptQueue.push({ bundle, prompt, attempt: attempt + 1 });
          continue;
        }

        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown_error';
        console.error(
          `LLM call failed for ${bundle.artworkId} after ${attempt} attempts: ${message}. Skipping for now.`,
        );
        skipped += 1;
      }
    }

    if (records.length > 0) {
      await appendRecords(OUTPUT_PATH, records);
      completed += records.length;
      for (const id of successfulIds) {
        processedIds.add(id);
      }
    }

    console.log(
      `Chunk complete: processed ${completed}/${toProcess.length} (skipped due to errors: ${skipped}).`,
    );
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\nDone!');
  console.log(`Processed: ${completed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Elapsed: ${elapsed.toFixed(1)} seconds`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
