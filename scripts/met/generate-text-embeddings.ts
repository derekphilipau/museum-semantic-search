#!/usr/bin/env tsx

import { loadEnvConfig } from '@next/env';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { parse } from 'csv-parse';
import { embedJinaTextBatch, EMBEDDING_MODELS } from '../../lib/embeddings';

const projectDir = path.join(__dirname, '..', '..');
loadEnvConfig(projectDir, true);

const DATA_DIR = path.join(projectDir, 'data', 'met');
const CSV_PATH = path.join(DATA_DIR, 'MetPaintingsWithImages.csv');
const DESCRIPTIONS_PATH = path.join(
  DATA_DIR,
  'descriptions',
  'gemini_2_5_flash',
  'edited_descriptions.jsonl'
);
const OUTPUT_DIR = path.join(DATA_DIR, 'embeddings', 'jina_text');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'embeddings.jsonl');

interface DescriptionRecord {
  artwork_id: string;
  alt_text?: string;
  long_description?: string;
  emoji_summary?: string;
  timestamp?: string;
}

interface ArtworkRow {
  id: string;
  title: string;
  titles: string[];
  artist: string;
  artists: string[];
  date: string;
  medium: string;
  classification: string;
  department: string;
  culture: string;
  period: string;
  dynasty: string;
  reign: string;
  portfolio: string;
  artistBio: string;
  artistNationality: string;
  artistRole: string;
  creditLine: string;
  dimensions: string;
  city: string;
  state: string;
  country: string;
  region: string;
  subregion: string;
  locale: string;
  tags: string[];
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
  };
}

interface CliOptions {
  output: string;
  limit?: number;
  skipExisting: boolean;
  batchSize: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: OUTPUT_FILE,
    skipExisting: true,
    batchSize: Number.parseInt(process.env.MET_TEXT_EMBED_BATCH || '16', 10),
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
      case '--batch':
        options.batchSize = Number.parseInt(argv[++i], 10);
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`Ignoring unknown option ${arg}`);
        }
    }
  }

  options.batchSize = Math.max(1, options.batchSize || 16);
  return options;
}

async function loadDescriptions(): Promise<Map<string, DescriptionRecord>> {
  const descriptions = new Map<string, DescriptionRecord>();

  try {
    await fs.access(DESCRIPTIONS_PATH);
  } catch {
    console.warn('Edited descriptions not found, continuing without them');
    return descriptions;
  }

  const fileStream = createReadStream(DESCRIPTIONS_PATH, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as DescriptionRecord;
      if (record.artwork_id) {
        descriptions.set(record.artwork_id, record);
      }
    } catch (error) {
      console.warn('Failed to parse description line');
    }
  }

  return descriptions;
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

          const titles = (row['Title'] || '')
            .split('|')
            .map((value) => value.trim())
            .filter(Boolean);
          const artists = (row['Artist Display Name'] || '')
            .split('|')
            .map((value) => value.trim())
            .filter(Boolean);
          const tags = (row['Tags'] || '')
            .split('|')
            .map((value) => value.trim())
            .filter(Boolean);

          rows.push({
            id: `met_${objectId}`,
            title: titles[0] || '',
            titles,
            artist: artists[0] || '',
            artists,
            date: row['Object Date'] || '',
            medium: row['Medium'] || '',
            classification: row['Classification'] || '',
            department: row['Department'] || '',
            culture: row['Culture'] || '',
            period: row['Period'] || '',
            dynasty: row['Dynasty'] || '',
            reign: row['Reign'] || '',
            portfolio: row['Portfolio'] || '',
            artistBio: row['Artist Display Bio'] || '',
            artistNationality: row['Artist Nationality'] || '',
            artistRole: row['Artist Role'] || '',
            creditLine: row['Credit Line'] || '',
            dimensions: row['Dimensions'] || '',
            city: row['City'] || '',
            state: row['State'] || '',
            country: row['Country'] || '',
            region: row['Region'] || '',
            subregion: row['Subregion'] || '',
            locale: row['Locale'] || '',
            tags,
          });
        }

        resolve();
      }
    );
  });

  return rows;
}

function createTextPayload(
  artwork: ArtworkRow,
  description?: DescriptionRecord
): string {
  const parts: string[] = [];

  if (description?.long_description) {
    parts.push(`Detailed description: ${description.long_description}`);
  }

  if (description?.alt_text) {
    parts.push(`Alt text: ${description.alt_text}`);
  }

  if (artwork.titles.length) {
    parts.push(`Titles: ${artwork.titles.join('; ')}`);
  }

  if (artwork.artists.length) {
    parts.push(`Artists: ${artwork.artists.join('; ')}`);
  }

  if (artwork.medium) {
    parts.push(`Medium: ${artwork.medium}`);
  }

  if (artwork.classification) {
    parts.push(`Classification: ${artwork.classification}`);
  }

  if (artwork.department) {
    parts.push(`Department: ${artwork.department}`);
  }

  if (artwork.date) {
    parts.push(`Date: ${artwork.date}`);
  }

  const locationTokens = [
    artwork.culture,
    artwork.period,
    artwork.dynasty,
    artwork.reign,
    artwork.country,
    artwork.region,
    artwork.subregion,
    artwork.city,
    artwork.state,
  ].filter(Boolean);
  if (locationTokens.length) {
    parts.push(`Context: ${locationTokens.join(', ')}`);
  }

  if (artwork.tags.length) {
    parts.push(`Tags: ${artwork.tags.join(', ')}`);
  }

  if (artwork.dimensions) {
    parts.push(`Dimensions: ${artwork.dimensions}`);
  }

  if (artwork.creditLine) {
    parts.push(`Credit line: ${artwork.creditLine}`);
  }

  if (artwork.artistBio) {
    parts.push(`Artist biography: ${artwork.artistBio}`);
  }

  return parts.join('\n');
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
      // Ignore malformed lines
    }
  }

  return ids;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    const [descriptions, artworks, existingIds] = await Promise.all([
      loadDescriptions(),
      loadArtworks(options.limit),
      options.skipExisting ? loadExistingIds(options.output) : Promise.resolve(new Set<string>()),
    ]);

    console.log(`Loaded ${artworks.length} artworks from CSV`);
    console.log(`Loaded ${descriptions.size} edited descriptions`);
    if (existingIds.size) {
      console.log(`Found ${existingIds.size} existing embeddings (will skip)`);
    }

    await fs.mkdir(path.dirname(options.output), { recursive: true });
    const writer = createWriteStream(options.output, { flags: options.skipExisting ? 'a' : 'w' });

    let processed = 0;
    let skipped = 0;

    const batchSize = options.batchSize;
    const dimension = EMBEDDING_MODELS.jina_text.dimension;

    for (let i = 0; i < artworks.length; i += batchSize) {
      const batch = artworks.slice(i, i + batchSize);

      const batchToEmbed = batch.filter((record) => {
        if (existingIds.has(record.id)) {
          skipped += 1;
          return false;
        }
        return true;
      });

      if (batchToEmbed.length === 0) {
        continue;
      }

      const texts = batchToEmbed.map((record) =>
        createTextPayload(record, descriptions.get(record.id))
      );

      const { vectors } = await embedJinaTextBatch(texts);

      vectors.forEach((vector, index) => {
        const artwork = batchToEmbed[index];
        const record: EmbeddingRecord = {
          artwork_id: artwork.id,
          embedding: vector.values,
          dimension: vector.dimension || dimension,
          model: 'jina_text',
          timestamp: new Date().toISOString(),
          metadata: {
            title: artwork.title,
            artist: artwork.artist || 'Unknown',
            department: artwork.department || undefined,
          },
        };
        writer.write(`${JSON.stringify(record)}\n`);
        processed += 1;
      });

      console.log(
        `Embedded ${processed} artworks (skipped ${skipped})`
      );
    }

    writer.end();
    console.log(`Completed. Output → ${options.output}`);
  } catch (error) {
    console.error('generate-text-embeddings failed:', error);
    process.exit(1);
  }
}

void main();
