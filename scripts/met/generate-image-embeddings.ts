#!/usr/bin/env tsx

import { loadEnvConfig } from '@next/env';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { parse } from 'csv-parse';
import { EMBEDDING_MODELS, embedJinaClipImage } from '../../lib/embeddings';

// Note: install `sharp` locally (`npm install sharp`) so large images can be
// compressed automatically before calling the Jina API.

const projectDir = path.join(__dirname, '..', '..');
loadEnvConfig(projectDir, true);

const DATA_DIR = path.join(projectDir, 'data', 'met');
const CSV_PATH = path.join(DATA_DIR, 'MetPaintingsWithImages.csv');
const OUTPUT_DIR = path.join(DATA_DIR, 'embeddings', 'jina_clip');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'embeddings.jsonl');

interface ArtworkRow {
  id: string;
  title: string;
  artist: string;
  department: string;
  primaryImage: string;
  primaryImageSmall: string;
}

interface EmbeddingRecord {
  artwork_id: string;
  embedding: number[];
  dimension: number;
  model: string;
  timestamp: string;
  metadata: {
    title: string;
    artist: string;
    department?: string;
    source_url: string;
  };
}

interface CliOptions {
  output: string;
  limit?: number;
  skipExisting: boolean;
  batchSize: number;
  retryCount: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: OUTPUT_FILE,
    skipExisting: true,
    batchSize: 1,
    retryCount: 3,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--output':
        options.output = path.isAbsolute(argv[i + 1])
          ? argv[++i]
          : path.join(projectDir, argv[++i]);
        break;
      case '--limit':
        options.limit = Number.parseInt(argv[++i], 10);
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '--retries':
        options.retryCount = Number.parseInt(argv[++i], 10);
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Ignoring unknown option ${arg}`);
        }
    }
  }

  return options;
}

async function loadArtworks(limit?: number): Promise<ArtworkRow[]> {
  const rows: ArtworkRow[] = [];
  const csvContent = await fs.readFile(CSV_PATH, 'utf-8');

  await new Promise<void>((resolve, reject) => {
    parse(
      csvContent,
      {
        columns: true,
        skip_empty_lines: true,
        bom: true,
      },
      (error, records: Record<string, string>[]) => {
        if (error) {
          reject(error);
          return;
        }

        for (const row of records) {
          if (limit && rows.length >= limit) break;

          const objectId = row['Object ID'];
          if (!objectId) continue;

          const small = row['primaryImageSmall'] || '';
          const full = row['primaryImage'] || '';
          if (!small && !full) {
            continue;
          }

          rows.push({
            id: `met_${objectId}`,
            title: row['Title'] || '',
            artist: row['Artist Display Name'] || '',
            department: row['Department'] || '',
            primaryImage: full,
            primaryImageSmall: small,
          });
        }

        resolve();
      }
    );
  });

  return rows;
}

async function loadExistingIds(outputPath: string): Promise<Set<string>> {
  const ids = new Set<string>();

  try {
    await fs.access(outputPath);
  } catch {
    return ids;
  }

  const stream = createReadStream(outputPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as EmbeddingRecord;
      ids.add(record.artwork_id);
    } catch {
      // ignore malformed line
    }
  }

  return ids;
}

async function downloadImageBuffer(
  url: string,
  retries: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(arrayBuffer);
      return { buffer, mimeType };
    } catch (error) {
      if (attempt === retries - 1) {
        console.warn(`  Failed to download image ${url}:`, error);
      } else {
        const delay = Math.min(2000 * (attempt + 1), 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return null;
}

// Jina's public API accepts reasonably large payloads, but we compress anything
// above ~200kB to keep requests fast and predictable.
const MAX_PAYLOAD_BYTES = Number(
  process.env.JINA_CLIP_MAX_PAYLOAD ?? '200000'
);
const MAX_JINA_RETRIES = Number(
  process.env.JINA_CLIP_RETRIES ?? '5'
);
const BASE_RETRY_DELAY_MS = Number(
  process.env.JINA_CLIP_RETRY_DELAY_MS ?? '1000'
);
type SharpModule = typeof import('sharp');
let sharpLoader: Promise<SharpModule | null> | null = null;

async function getSharpInstance(): Promise<SharpModule | null> {
  if (!sharpLoader) {
    sharpLoader = import('sharp')
      .then((mod) => (mod.default ?? mod) as SharpModule)
      .catch(() => {
        console.warn(
          '[generate-image-embeddings] Install "sharp" to enable automatic image compression when Gemini payloads exceed 32KB.'
        );
        return null;
      });
  }
  return sharpLoader;
}

async function ensurePayloadLimit(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (buffer.length <= MAX_PAYLOAD_BYTES) {
    return { buffer, mimeType };
  }

  const sharpModule = await getSharpInstance();
  if (!sharpModule) {
    throw new Error(
      `Image payload ${buffer.length} bytes exceeds configured limit (${MAX_PAYLOAD_BYTES}).`
    );
  }

  const widthLevels = [768, 640, 512, 384, 320];
  const qualityLevels = [85, 75, 65, 55, 45, 35];
  let smallest: Buffer | null = null;

  for (const width of widthLevels) {
    for (const quality of qualityLevels) {
      const candidate = await sharpModule(buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (!smallest || candidate.length < smallest.length) {
        smallest = candidate;
      }

      if (candidate.length <= MAX_PAYLOAD_BYTES) {
        return { buffer: candidate, mimeType: 'image/jpeg' };
      }
    }
  }

  const smallestSize = smallest ? smallest.length : buffer.length;
  throw new Error(
    `Unable to compress image below ${MAX_PAYLOAD_BYTES} bytes (smallest attempt ${smallestSize} bytes).`
  );
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    const [artworks, existingIds] = await Promise.all([
      loadArtworks(options.limit),
      options.skipExisting ? loadExistingIds(options.output) : Promise.resolve(new Set<string>()),
    ]);

    console.log(`Loaded ${artworks.length} artworks with image URLs`);
    if (existingIds.size) {
      console.log(`Found ${existingIds.size} existing embeddings (will skip)`);
    }

    await fs.mkdir(path.dirname(options.output), { recursive: true });
    const writer = createWriteStream(options.output, { flags: options.skipExisting ? 'a' : 'w' });

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const expectedDimension = EMBEDDING_MODELS.jina_clip.dimension;

    for (const artwork of artworks) {
      if (options.skipExisting && existingIds.has(artwork.id)) {
        skipped += 1;
        continue;
      }

      const imageUrl = artwork.primaryImageSmall || artwork.primaryImage;
      if (!imageUrl) {
        skipped += 1;
        continue;
      }

      console.log(`Embedding ${artwork.id} (${artwork.title || 'Untitled'})`);
      const download = await downloadImageBuffer(imageUrl, options.retryCount);
      if (!download) {
        failed += 1;
        continue;
      }

      try {
        const prepared = await ensurePayloadLimit(download.buffer, download.mimeType);
        if (prepared.buffer.length < download.buffer.length) {
          console.log(
            `  -> Compressed image payload ${download.buffer.length} bytes to ${prepared.buffer.length} bytes`
          );
        }
        const base64 = prepared.buffer.toString('base64');

        let vector: EmbeddingRecord['embedding'] | null = null;
        let dimension = expectedDimension;
        for (let attempt = 1; attempt <= MAX_JINA_RETRIES; attempt += 1) {
          try {
            const result = await embedJinaClipImage(base64, prepared.mimeType);
            vector = result.values;
            dimension = result.dimension ?? expectedDimension;
            break;
          } catch (error) {
            const status = (error as { status?: number }).status;
            const detail = (error as { detail?: string }).detail?.toLowerCase() || '';
            const message = (error as Error).message.toLowerCase();
            const rateLimited =
              status === 429 ||
              (status === 403 && detail.includes('rate')) ||
              message.includes('rate limit');

            if (rateLimited && attempt < MAX_JINA_RETRIES) {
              const delay = Math.min(
                BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
                15000
              );
              console.warn(
                `  ⚠️ Jina rate-limit (attempt ${attempt}/${MAX_JINA_RETRIES}). Retrying in ${delay} ms...`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }

            throw error;
          }
        }

        if (!vector) {
          throw new Error('Failed to obtain Jina CLIP embedding after retries');
        }

        const record: EmbeddingRecord = {
          artwork_id: artwork.id,
          embedding: vector,
          dimension,
          model: 'jina_clip',
          timestamp: new Date().toISOString(),
          metadata: {
            title: artwork.title,
            artist: artwork.artist || 'Unknown',
            department: artwork.department || undefined,
            source_url: imageUrl,
          },
        };

        writer.write(`${JSON.stringify(record)}\n`);
        processed += 1;
      } catch (error) {
        console.error(`  ✗ Embedding failed (image skipped):`, error);
        failed += 1;
      }

      // Gentle pacing to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    writer.end();
    console.log(`Completed. Processed ${processed}, skipped ${skipped}, failed ${failed}. Output → ${options.output}`);
  } catch (error) {
    console.error('generate-image-embeddings failed:', error);
    process.exit(1);
  }
}

void main();
