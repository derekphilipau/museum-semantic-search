import type { KnowledgeCapsule } from './capsule';
import {
  formatSlowLookingElementsForPlanner,
  type PromptStrategy,
} from '@/lib/slow-looking';

export interface PlannerMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RetrievalTask {
  query: string;
  rationale?: string;
}

export interface RetrievalPlan {
  tasks: RetrievalTask[];
  raw?: string;
  promptStrategy?: PromptStrategy;
  targetElements?: string[];
}

interface PlanRetrievalInput {
  artifactId: string;
  apiKey: string;
  model: string;
  userQuery: string;
  recentMessages: PlannerMessage[];
  capsule: KnowledgeCapsule | null;
  maxTasks?: number;
}

const DEFAULT_MAX_TASKS = 3;

interface PlannerPromptOptions {
  artifactId: string;
  userQuery: string;
  recentMessages: PlannerMessage[];
  capsule: KnowledgeCapsule | null;
  maxTasks: number;
}

function buildPlannerPrompt({
  artifactId,
  userQuery,
  recentMessages,
  capsule,
  maxTasks,
}: PlannerPromptOptions) {
  const historySnippet =
    recentMessages.length === 0
      ? 'None'
      : recentMessages
          .slice(-4)
          .map((msg) => `${msg.role}: ${msg.content}`)
          .join('\n');

  const relatedEntities =
    capsule?.related_entities?.map((entity) => {
      const relation = entity.relation
        ? entity.relation.replace(/_/g, ' ')
        : 'related';
      return `${entity.label} (${relation})`;
    }) ?? [];

  const documentTitles =
    capsule?.documents?.map(
      (doc) => doc.source_title ?? doc.doc_id ?? '(untitled source)'
    ) ?? [];

  const slowLookingElements = formatSlowLookingElementsForPlanner(artifactId);

  const promptSections = [
    `USER QUERY:\n${userQuery}`,
    `RECENT HISTORY (last few turns):\n${historySnippet}`,
    `ALLOWED ENTITIES / TOPICS:\n${
      relatedEntities.length > 0
        ? relatedEntities.join(', ')
        : '(none listed for this capsule)'
    }`,
    `SOURCE TITLES:\n${
      documentTitles.length > 0
        ? documentTitles.join('; ')
        : '(no additional documents recorded)'
    }`,
    `SLOW-LOOKING ELEMENTS:\n${slowLookingElements}`,
    `OUTPUT INSTRUCTIONS:\n- Decide on a prompt strategy: OBSERVATION_FIRST (invite visual exploration), FACT_FIRST (pure factual answer), or DEFLECT (outside scope/unsafe).\n- target_elements may list up to 2 element IDs from the SLOW-LOOKING ELEMENTS section.\n- Propose up to ${maxTasks} focused Elasticsearch queries in "tasks".\n- Each task.query MUST be a short natural-language search phrase (no JSON, DSL, or Lucene syntax).\n- Stay strictly within the allowed topics/entities above.\n- Prefer concrete entity names over pronouns when possible.\n- Respond with JSON matching {"prompt_strategy":"...","target_elements":["..."],"tasks":[{"query":"...","rationale":"..."}]}.\n- Omit any task if you cannot stay within the allowed topics.\n- If the user request is completely unsupported, return {"prompt_strategy":"DEFLECT","target_elements":[],"tasks":[]}.`,
  ];

  return promptSections.join('\n\n');
}

function parsePlannerResponse(
  rawResponse: string,
  maxTasks: number
): RetrievalPlan {
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    const jsonContent = jsonMatch ? jsonMatch[0] : rawResponse;
    const parsed = JSON.parse(jsonContent) as {
      prompt_strategy?: string;
      target_elements?: unknown;
      tasks?: RetrievalTask[];
    };

    const plan: RetrievalPlan = {
      tasks: [],
      raw: rawResponse,
    };

    if (typeof parsed.prompt_strategy === 'string') {
      const normalized = parsed.prompt_strategy.toUpperCase();
      if (
        normalized === 'OBSERVATION_FIRST' ||
        normalized === 'FACT_FIRST' ||
        normalized === 'DEFLECT'
      ) {
        plan.promptStrategy = normalized as PromptStrategy;
      }
    }

    if (Array.isArray(parsed.target_elements)) {
      const elements = parsed.target_elements
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean);
      if (elements.length > 0) {
        plan.targetElements = elements.slice(0, 3);
      }
    }

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter(
            (task) =>
              typeof task === 'object' &&
              typeof task.query === 'string' &&
              task.query.trim().length > 0
          )
      : [];

    plan.tasks = tasks
      .slice(0, maxTasks)
      .map((task) => ({
        query: task.query.trim(),
        rationale:
          typeof task.rationale === 'string'
            ? task.rationale.trim()
            : undefined,
      }));

    return plan;
  } catch (error) {
    console.warn('[retrieval-planner] failed to parse response', error, rawResponse);
    return { tasks: [], raw: rawResponse };
  }
}

export async function planRetrievalTasks({
  artifactId,
  apiKey,
  model,
  userQuery,
  recentMessages,
  capsule,
  maxTasks = DEFAULT_MAX_TASKS,
}: PlanRetrievalInput): Promise<RetrievalPlan> {
  try {
    async function callPlanner(modelName: string) {
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.1,
          max_tokens: 240,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You generate Elasticsearch retrieval plans for a museum chat assistant. Stay inside the allowed topics and produce valid JSON.',
            },
            {
              role: 'user',
              content: buildPlannerPrompt({
                artifactId,
                userQuery,
                recentMessages,
                capsule,
                maxTasks,
              }),
            },
          ],
        }),
      });
    }

    const fallbackModel = model !== 'gpt-4o-mini' ? 'gpt-4o-mini' : null;
    const orderedModels = [model, fallbackModel].filter(
      (candidate): candidate is string => Boolean(candidate)
    );

    let response: Response | null = null;
    for (const candidate of orderedModels) {
      const attempt = await callPlanner(candidate);
      if (attempt.ok) {
        response = attempt;
        break;
      }
      try {
        const errorPayload = await attempt.json();
        console.warn('[retrieval-planner] OpenAI error', candidate, attempt.status, errorPayload);
      } catch (error) {
        console.warn('[retrieval-planner] OpenAI error', candidate, attempt.status, error);
      }
    }

    if (!response) {
      return { tasks: [] };
    }

    const completion = await response.json();
    const content =
      completion?.choices?.[0]?.message?.content ??
      JSON.stringify({ tasks: [] });

    return parsePlannerResponse(content, maxTasks);
  } catch (error) {
    console.warn('[retrieval-planner] planner call failed', error);
    return { tasks: [] };
  }
}
