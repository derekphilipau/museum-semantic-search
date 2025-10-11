#!/usr/bin/env tsx
/**
 * Suggest related Wikipedia/Wikidata references for an artwork capsule using Gemini.
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/trusted_context/suggest-links.ts --artifact-config data/trusted_corpus/artifacts/met_436105.json
 *
 * Options:
 *   --artifact-config   Path to the artifact config JSON (required)
 *   --model             Gemini model (default: gemini-2.5-flash)
 *   --max-suggestions   Maximum number of entities to request (default: 12)
 *   --output            Optional override for output path
 *   --dry-run           Print the prompt without calling Gemini
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';

interface ArtifactConfig {
  artifact_id: string;
  title?: string;
  artist?: {
    name?: string;
    wikidata_id?: string;
  };
  object_date?: string;
  medium?: string;
  dimensions?: string;
  department?: string;
  documents?: Array<Record<string, unknown>>;
  related_entities?: Array<Record<string, unknown>>;
  visual_description_source?: {
    path?: string;
    field?: string;
    alt_text_field?: string;
    emoji_field?: string;
    artwork_id_field?: string;
  };
}

interface SuggestionResponse {
  suggestions?: Array<Record<string, unknown>>;
}

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_VISUAL_DESCRIPTIONS = path.join(
  ROOT_DIR,
  'data',
  'met',
  'descriptions',
  'gemini_2_5_flash',
  'edited_descriptions.jsonl'
);
const SUGGESTION_DIR = path.join(ROOT_DIR, 'data', 'trusted_corpus', 'suggestions');

function loadEnvFiles() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.join(ROOT_DIR, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;
      const key = line.substring(0, eqIndex).trim();
      let value = line.substring(eqIndex + 1).trim();
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
  }
}

loadEnvFiles();

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string | number | boolean | undefined> = {
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    maxSuggestions: 12,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--artifact-config' && args[i + 1]) {
      result.artifactConfig = args[++i];
    } else if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--max-suggestions' && args[i + 1]) {
      result.maxSuggestions = Number.parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      result.output = args[++i];
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  if (!result.artifactConfig) {
    throw new Error('Missing required --artifact-config argument');
  }
  return result;
}

async function loadArtifactConfig(configPath: string): Promise<ArtifactConfig> {
  const resolved = path.isAbsolute(configPath) ? configPath : path.join(ROOT_DIR, configPath);
  const raw = await fs.readFile(resolved, 'utf-8');
  return JSON.parse(raw) as ArtifactConfig;
}

async function loadVisualDescription(
  artifactId: string,
  source: ArtifactConfig['visual_description_source']
) {
  const pathOverride = source?.path ?? DEFAULT_VISUAL_DESCRIPTIONS;
  const resolved = path.isAbsolute(pathOverride) ? pathOverride : path.join(ROOT_DIR, pathOverride);
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
  throw new Error(`Could not find visual description for ${artifactId} in ${resolved}`);
}

function buildPrompt({
  artifactConfig,
  visualDescription,
  maxSuggestions,
}: {
  artifactConfig: ArtifactConfig;
  visualDescription: { alt_text?: string; long_description?: string; emoji_summary?: string };
  maxSuggestions: number;
}) {
  const metadata = {
    artifact_id: artifactConfig.artifact_id,
    title: artifactConfig.title,
    artist: artifactConfig.artist?.name,
    artist_wikidata_id: artifactConfig.artist?.wikidata_id,
    object_date: artifactConfig.object_date,
    medium: artifactConfig.medium,
    dimensions: artifactConfig.dimensions,
    department: artifactConfig.department,
    existing_documents: artifactConfig.documents ?? [],
    related_entities: artifactConfig.related_entities ?? [],
  };

  const systemInstruction =
    'You are a museum knowledge curator. Given artwork metadata and a visual description, propose relevant reference entities we can preload from a trusted offline corpus. Only suggest entities that a reliable citation-backed knowledge base would cover.';

  const instructions = `Return a JSON object with a \`suggestions\` array (maximum ${maxSuggestions} entries). Each entry must follow this schema:
{
  "label": <canonical human-readable label>,
  "category": one of ["artwork","artist","person","place","movement","concept","event","literary_source"],
  "wikipedia_title": <preferred Wikipedia article title or null>,
  "wikidata_id": <Wikidata identifier or null>,
  "reason": <1-2 sentence justification tied to the artwork>,
  "confidence": <number between 0.0 and 1.0>,
  "evidence": <short quote or reference to supplied metadata/description triggering this suggestion>
}

Guidelines:
- Prioritize entities directly related to the artwork's subject, artist, depicted figures, movements, or historical context.
- Do NOT invent IDs: use null if unknown.
- Avoid duplicates of entities already present in \`existing_documents\` or \`related_entities\`.
- Prefer high-confidence suggestions that enrich visitor understanding without leaving the approved scope.
- If uncertainty remains, include a lower-confidence suggestion but flag it with confidence <= 0.4.
`;

  const payload = {
    metadata,
    visual_description: {
      alt_text: visualDescription.alt_text,
      emoji_summary: visualDescription.emoji_summary,
      long_description: visualDescription.long_description,
    },
  };

  const promptText = `${instructions}\n\nINPUT:\n${JSON.stringify(payload, null, 2)}`;
  return { systemInstruction, promptText };
}

function getModel(modelName: string, systemInstruction: string): GenerativeModel {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_GEMINI_API_KEY) must be set');
  }
  const client = new GoogleGenerativeAI(apiKey);
  return client.getGenerativeModel({
    model: modelName,
    systemInstruction,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });
}

async function run() {
  const args = parseArgs();
  const artifactConfig = await loadArtifactConfig(String(args.artifactConfig));
  const visualDescription = await loadVisualDescription(
    artifactConfig.artifact_id,
    artifactConfig.visual_description_source
  );
  const { systemInstruction, promptText } = buildPrompt({
    artifactConfig,
    visualDescription,
    maxSuggestions: Number(args.maxSuggestions),
  });

  if (args.dryRun) {
    console.log('=== SYSTEM INSTRUCTION ===\n', systemInstruction);
    console.log('\n=== PROMPT ===\n', promptText);
    return;
  }

  const model = getModel(String(args.model), systemInstruction);
  const response = await model.generateContent(promptText);
  const text = response.response.text();
  if (!text?.trim()) {
    throw new Error('Empty response from Gemini');
  }

  let parsed: SuggestionResponse;
  try {
    parsed = JSON.parse(text) as SuggestionResponse;
  } catch (error) {
    throw new Error(`Failed to parse JSON response from Gemini: ${(error as Error).message}`);
  }

  const outputPath =
    args.output && typeof args.output === 'string'
      ? path.isAbsolute(args.output)
        ? args.output
        : path.join(ROOT_DIR, args.output)
      : path.join(SUGGESTION_DIR, `${artifactConfig.artifact_id}.json`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    artifact_id: artifactConfig.artifact_id,
    model: args.model,
    generated_at: new Date().toISOString(),
    prompt: {
      system_instruction: systemInstruction,
      input: promptText,
    },
    suggestions: parsed.suggestions ?? [],
  };
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Wrote suggestions → ${path.relative(ROOT_DIR, outputPath)}`);
  console.log(`Total suggestions: ${payload.suggestions.length}`);
}

run().catch((error) => {
  console.error('Suggestion script failed:', error);
  process.exit(1);
});
