#!/usr/bin/env tsx
/**
 * Fetch Wikipedia pages and store them as offline JSON documents for capsule ingestion.
 *
 * Examples:
 *   npx tsx scripts/trusted_context/fetch-wikipedia.ts --title "The Death of Socrates" --capsule-family artwork
 *   npx tsx scripts/trusted_context/fetch-wikipedia.ts --suggestions data/trusted_corpus/suggestions/met_436105.json
 */

import { promises as fs } from 'fs';
import path from 'path';

type CapsuleFamily = 'artwork' | 'subject';

interface SuggestionRecord {
  label?: string;
  category?: string;
  wikipedia_title?: string | null;
}

interface SuggestionFile {
  suggestions?: SuggestionRecord[];
}

interface PageRequest {
  title: string;
  capsuleFamily: CapsuleFamily;
}

interface WikipediaPage {
  title: string;
  pageid: number;
  extract?: string;
  revisions?: Array<{ revid: number; timestamp: string }>;
  missing?: boolean;
}

interface DocumentSection {
  heading: string | null;
  text: string;
}

interface CapsuleDocument {
  doc_id: string;
  title: string;
  source: {
    type: string;
    url: string;
    retrieved?: string;
    license: string;
    page_id: number;
    revision_id?: number;
  };
  capsule_family: CapsuleFamily;
  entity_ids: string[];
  sections: DocumentSection[];
}

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'trusted_corpus', 'raw', 'wikipedia');

const CATEGORY_TO_FAMILY: Record<string, CapsuleFamily> = {
  artwork: 'artwork',
  artist: 'subject',
  person: 'subject',
  place: 'subject',
  movement: 'subject',
  concept: 'subject',
  event: 'subject',
  literary_source: 'subject',
};

const HEADING_PATTERN = /^=+\s*(.+?)\s*=+$/;

function parseArgs() {
  const args = process.argv.slice(2);
  const config: {
    titles: string[];
    capsuleFamily: CapsuleFamily;
    suggestionsPath?: string;
    outputDir: string;
    overwrite: boolean;
    dryRun: boolean;
  } = {
    titles: [],
    capsuleFamily: 'subject',
    outputDir: DEFAULT_OUTPUT_DIR,
    overwrite: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--title':
        if (!args[i + 1]) throw new Error('Missing value for --title');
        config.titles.push(args[++i]);
        break;
      case '--capsule-family':
        if (!args[i + 1]) throw new Error('Missing value for --capsule-family');
        {
          const family = args[++i] as CapsuleFamily;
          if (!['artwork', 'subject'].includes(family)) {
            throw new Error(`Invalid capsule family: ${family}`);
          }
          config.capsuleFamily = family;
        }
        break;
      case '--suggestions':
        if (!args[i + 1]) throw new Error('Missing value for --suggestions');
        config.suggestionsPath = args[++i];
        break;
      case '--out-dir':
        if (!args[i + 1]) throw new Error('Missing value for --out-dir');
        config.outputDir = args[++i];
        break;
      case '--overwrite':
        config.overwrite = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      default:
        console.warn(`Ignoring unknown argument: ${arg}`);
    }
  }

  if (!config.suggestionsPath && config.titles.length === 0) {
    throw new Error('Provide at least one --title or a --suggestions JSON file.');
  }

  return config;
}

async function loadTitlesFromSuggestions(filePath: string): Promise<PageRequest[]> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  const raw = await fs.readFile(resolved, 'utf-8');
  const data = JSON.parse(raw) as SuggestionFile;

  const requests: PageRequest[] = [];
  const seen = new Set<string>();

  for (const suggestion of data.suggestions ?? []) {
    const maybeTitle = suggestion.wikipedia_title || suggestion.label;
    if (!maybeTitle) continue;
    const normalized = normalizeTitle(maybeTitle);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const category = suggestion.category ?? 'subject';
    const capsuleFamily = CATEGORY_TO_FAMILY[category] ?? 'subject';
    requests.push({ title: maybeTitle, capsuleFamily });
  }

  return requests;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, '_');
}

async function fetchWikipediaPage(title: string): Promise<WikipediaPage> {
  let currentTitle = title;
  let searched = false;

  while (true) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'extracts|revisions|info',
      explaintext: '1',
      exsectionformat: 'plain',
      redirects: '1',
      rvprop: 'ids|timestamp',
      titles: currentTitle,
    });

    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${currentTitle}: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      query?: { pages?: WikipediaPage[] };
    };

    const page = payload.query?.pages?.[0];
    if (page && !page.missing) {
      if (currentTitle !== page.title) {
        console.log(`Resolved '${title}' → '${page.title}' via Wikipedia redirects/search.`);
      }
      return page;
    }

    if (!searched) {
      const fallback = await searchWikipediaTitle(title);
      searched = true;
      if (fallback && fallback.toLowerCase() !== currentTitle.toLowerCase()) {
        currentTitle = fallback;
        continue;
      }
    }

    throw new Error(`Wikipedia page not found for title: ${title}`);
  }
}

async function searchWikipediaTitle(query: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'search',
    srsearch: query,
    srlimit: '1',
  });

  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
  if (!response.ok) {
    console.warn(`Search fallback failed for '${query}': ${response.status} ${response.statusText}`);
    return null;
  }

  const payload = (await response.json()) as {
    query?: { search?: Array<{ title: string }> };
  };

  const hit = payload.query?.search?.[0];
  if (hit?.title) {
    return hit.title;
  }

  return null;
}

function splitIntoSections(extract?: string): DocumentSection[] {
  if (!extract) return [];

  const sections: DocumentSection[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    const text = currentLines.join('\n').trim();
    if (text) {
      sections.push({ heading: currentHeading, text });
    }
    currentHeading = null;
    currentLines = [];
  };

  for (const line of extract.split(/\r?\n/)) {
    const headingMatch = HEADING_PATTERN.exec(line.trim());
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function buildDocument(page: WikipediaPage, capsuleFamily: CapsuleFamily): CapsuleDocument {
  const revision = page.revisions?.[0];
  const normalized = normalizeTitle(page.title).toLowerCase();
  return {
    doc_id: `wiki:${normalized}`,
    title: page.title,
    source: {
      type: 'wikipedia',
      url: `https://en.wikipedia.org/wiki/${normalizeTitle(page.title)}`,
      retrieved: revision?.timestamp,
      license: 'CC-BY-SA-4.0',
      page_id: page.pageid,
      revision_id: revision?.revid,
    },
    capsule_family: capsuleFamily,
    entity_ids: [],
    sections: splitIntoSections(page.extract),
  };
}

async function writeDocument(document: CapsuleDocument, outDir: string, overwrite: boolean) {
  const slug = document.doc_id.replace(/^wiki:/, '');
  const targetDir = path.isAbsolute(outDir) ? outDir : path.join(ROOT_DIR, outDir);
  const targetPath = path.join(targetDir, `${slug}.json`);

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (!overwrite) {
      try {
        await fs.access(targetPath);
        console.log(`Skipping existing file: ${path.relative(ROOT_DIR, targetPath)}`);
        return;
      } catch {
        // File does not exist, proceed to write
      }
    }
    await fs.writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    console.log(`Wrote ${path.relative(ROOT_DIR, targetPath)}`);
  } catch (error) {
    throw new Error(`Failed to write ${targetPath}: ${(error as Error).message}`);
  }
}

async function main() {
  const args = parseArgs();

  const requests: PageRequest[] = [];
  if (args.suggestionsPath) {
    requests.push(...(await loadTitlesFromSuggestions(args.suggestionsPath)));
  }
  if (args.titles.length > 0) {
    for (const title of args.titles) {
      requests.push({ title, capsuleFamily: args.capsuleFamily });
    }
  }

  // Deduplicate by normalized title, preferring the first capsule family encountered.
  const deduped = new Map<string, PageRequest>();
  for (const req of requests) {
    const normalized = normalizeTitle(req.title).toLowerCase();
    if (!deduped.has(normalized)) {
      deduped.set(normalized, req);
    }
  }
  const finalRequests = Array.from(deduped.values());

  if (args.dryRun) {
    console.log('Titles to fetch:');
    for (const req of finalRequests) {
      console.log(`  - ${req.title} (family=${req.capsuleFamily})`);
    }
    return;
  }

  for (const req of finalRequests) {
    try {
      const page = await fetchWikipediaPage(req.title);
      const document = buildDocument(page, req.capsuleFamily);
      await writeDocument(document, args.outputDir, args.overwrite);
    } catch (error) {
      console.error(`Error fetching '${req.title}':`, error);
    }
  }
}

main().catch((error) => {
  console.error('fetch-wikipedia.ts failed:', error);
  process.exit(1);
});
