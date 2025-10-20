import { NextResponse } from 'next/server';
import {
  KnowledgeSnippet,
  retrieveKnowledgeSnippets,
} from '@/lib/knowledge';
import {
  searchArtworksByClassification,
  searchArtworksByConstituent,
  searchArtworksBySemanticText,
  searchArtworksSimilar,
  type ArtworkSearchResult,
} from '@/lib/search/artworks';
import { SUPPORTED_ARTIFACT_ID } from '@/app/api/artwork-chat/route';

interface SnippetTask {
  id: string;
  type: 'snippet';
  query: string;
  size?: number;
}

interface ArtworkConstituentTask {
  id: string;
  type: 'artwork.constituent';
  artistId?: string;
  artistName?: string;
  size?: number;
  excludeIds?: string[];
}

interface ArtworkClassificationTask {
  id: string;
  type: 'artwork.classification';
  classification: string;
  size?: number;
  excludeIds?: string[];
}

interface ArtworkSemanticTask {
  id: string;
  type: 'artwork.semantic';
  text: string;
  size?: number;
  excludeIds?: string[];
}

interface ArtworkSimilarTask {
  id: string;
  type: 'artwork.similar';
  artworkId: string;
  size?: number;
  excludeIds?: string[];
}

type BatchTask =
  | SnippetTask
  | ArtworkConstituentTask
  | ArtworkClassificationTask
  | ArtworkSemanticTask
  | ArtworkSimilarTask;

interface BatchRequestBody {
  artifactId: string;
  tasks?: BatchTask[];
  fallbackQuery?: string;
  snippetSize?: number;
  snippetMinCount?: number;
}

interface SnippetLogEntry {
  taskId: string;
  query: string;
  hits: number;
  source: 'planner' | 'fallback';
  topSnippets?: Array<{ snippetId: string; sourceTitle?: string }>;
  rationale?: string;
}

interface ArtworkTaskResult {
  results: ArtworkSearchResult[];
  total: number;
}

interface BatchResponseBody {
  snippets: KnowledgeSnippet[];
  snippetLog: SnippetLogEntry[];
  artworks: Record<string, ArtworkTaskResult>;
}

const DEFAULT_SNIPPET_SIZE = 8;
const DEFAULT_SNIPPET_MIN_COUNT = 4;

function dedupeSnippets(snippets: KnowledgeSnippet[]): KnowledgeSnippet[] {
  const map = new Map<string, KnowledgeSnippet>();
  snippets.forEach((snippet) => {
    const existing = map.get(snippet.snippetId);
    if (!existing || (snippet.score ?? 0) > (existing.score ?? 0)) {
      map.set(snippet.snippetId, snippet);
    }
  });
  return Array.from(map.values());
}

function buildSnippetLogEntry(
  task: SnippetTask,
  snippets: KnowledgeSnippet[]
): SnippetLogEntry {
  return {
    taskId: task.id,
    query: task.query,
    hits: snippets.length,
    source: 'planner',
    topSnippets: snippets.slice(0, 3).map((snippet) => ({
      snippetId: snippet.snippetId,
      sourceTitle: snippet.sourceTitle,
    })),
  };
}

async function runArtworkTask(task: BatchTask): Promise<ArtworkTaskResult> {
  switch (task.type) {
    case 'artwork.constituent': {
      const payload = await searchArtworksByConstituent({
        artistId: task.artistId,
        artistName: task.artistName,
        size: task.size,
        excludeIds: task.excludeIds,
      });
      return payload;
    }
    case 'artwork.classification': {
      const payload = await searchArtworksByClassification({
        classification: task.classification,
        size: task.size,
        excludeIds: task.excludeIds,
      });
      return payload;
    }
    case 'artwork.semantic': {
      const payload = await searchArtworksBySemanticText({
        text: task.text,
        size: task.size,
        excludeIds: task.excludeIds,
      });
      return payload;
    }
    case 'artwork.similar': {
      const payload = await searchArtworksSimilar({
        artworkId: task.artworkId,
        size: task.size,
        excludeIds: task.excludeIds,
      });
      return payload;
    }
    default:
      return { results: [], total: 0 };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BatchRequestBody;

    if (!body.artifactId || typeof body.artifactId !== 'string') {
      return NextResponse.json(
        { error: 'artifactId is required.' },
        { status: 400 }
      );
    }

    if (body.artifactId !== SUPPORTED_ARTIFACT_ID) {
      return NextResponse.json(
        { error: 'Chat batch search is currently limited to met_436105.' },
        { status: 400 }
      );
    }

    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    const snippetTasks = tasks.filter(
      (task): task is SnippetTask => task.type === 'snippet'
    );
    const artworkTasks = tasks.filter(
      (task): task is Exclude<BatchTask, SnippetTask> =>
        task.type !== 'snippet'
    );

    const snippetPromises = snippetTasks.map(async (task) => {
      const results = await retrieveKnowledgeSnippets({
        artifactId: body.artifactId,
        query: task.query,
        size: task.size ?? DEFAULT_SNIPPET_SIZE,
      });
      return {
        task,
        results,
      };
    });

    const artworkPromises = artworkTasks.map(async (task) => {
      const results = await runArtworkTask(task);
      return {
        task,
        results,
      };
    });

    const snippetResults = await Promise.all(snippetPromises);
    const artworkResults = await Promise.all(artworkPromises);

    let mergedSnippets: KnowledgeSnippet[] = [];
    const snippetLog: SnippetLogEntry[] = [];

    snippetResults.forEach(({ task, results }) => {
      mergedSnippets.push(...results);
      snippetLog.push(buildSnippetLogEntry(task, results));
    });

    mergedSnippets = dedupeSnippets(mergedSnippets);

    const snippetMinCount =
      body.snippetMinCount ?? DEFAULT_SNIPPET_MIN_COUNT;
    const snippetSize = body.snippetSize ?? DEFAULT_SNIPPET_SIZE;

    if (
      body.fallbackQuery &&
      mergedSnippets.length < snippetMinCount &&
      !snippetTasks.some((task) => task.query === body.fallbackQuery)
    ) {
      const fallbackResults = await retrieveKnowledgeSnippets({
        artifactId: body.artifactId,
        query: body.fallbackQuery,
        size: snippetSize,
      });
      mergedSnippets = dedupeSnippets([
        ...mergedSnippets,
        ...fallbackResults,
      ]);
      snippetLog.push({
        taskId: 'fallback',
        query: body.fallbackQuery,
        hits: fallbackResults.length,
        source: 'fallback',
        topSnippets: fallbackResults.slice(0, 3).map((snippet) => ({
          snippetId: snippet.snippetId,
          sourceTitle: snippet.sourceTitle,
        })),
      });
    }

    mergedSnippets.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    mergedSnippets = mergedSnippets.slice(0, snippetSize);

    const artworkMap: Record<string, ArtworkTaskResult> = {};
    artworkResults.forEach(({ task, results }) => {
      artworkMap[task.id] = results;
    });

    const payload: BatchResponseBody = {
      snippets: mergedSnippets,
      snippetLog,
      artworks: artworkMap,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[chat-search] unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while processing batch search.' },
      { status: 500 }
    );
  }
}
