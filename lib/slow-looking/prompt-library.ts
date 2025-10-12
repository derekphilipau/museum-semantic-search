export type PromptStrategy = 'OBSERVATION_FIRST' | 'FACT_FIRST' | 'DEFLECT';

export interface SlowLookingPromptEntry {
  elementId: string;
  plannerDescription: string;
  focusDetail: string;
  prompts: string[];
  snippetIds: string[];
}

export interface SelectedSlowLookingPrompt {
  elementId: string;
  focusDetail: string;
  prompt: string;
  snippetIds: string[];
}

const PROMPT_LIBRARY: Record<string, SlowLookingPromptEntry[]> = {
  met_436105: [
    {
      elementId: 'gesture_pointing_up',
      plannerDescription:
        'gesture_pointing_up — Socrates raises his hand toward the upper space, signalling the immortality theme noted in Phaedo.',
      focusDetail:
        'Draw attention to Socrates raising his hand while remaining composed, linking the gesture to the immortality of the soul [S:wiki:the_death_of_socrates:0:0][S:wiki:the_death_of_socrates:1:0].',
      prompts: [
        'Do you notice Socrates lifting his hand upward? What does that upward gesture draw your attention to?',
        'Trace the line from his raised finger back toward the cup—what changes in light or edge quality do you see along that path?',
      ],
      snippetIds: [
        'wiki:the_death_of_socrates:0:0',
        'wiki:the_death_of_socrates:1:0',
      ],
    },
    {
      elementId: 'companions_row',
      plannerDescription:
        'companions_row — the frieze-like line of companions shows varied reactions beside Socrates.',
      focusDetail:
        'Mention how Socrates’ companions line the bench in a frieze-like row and register grief or disbelief [S:wiki:the_death_of_socrates:0:0][S:wiki:crito_of_alopece:0:3].',
      prompts: [
        'Looking along the bench, how do the companions’ poses differ from one another?',
        'Start at the figure gripping Socrates’ leg and scan LEFT to RIGHT—what feelings do their gestures suggest without words?',
      ],
      snippetIds: [
        'wiki:the_death_of_socrates:0:0',
        'wiki:crito_of_alopece:0:3',
      ],
    },
    {
      elementId: 'hemlock_exchange',
      plannerDescription:
        'hemlock_exchange — the exchange of the cup of hemlock between Socrates and his follower.',
      focusDetail:
        'Reference the cup of hemlock being offered to Socrates and his calm acceptance in front of his companions [S:wiki:the_death_of_socrates:0:0][S:wiki:socrates:1:0].',
      prompts: [
        'Can you spot the figure extending the cup toward Socrates? What details show how each person is handling that moment?',
        'Follow the path from the cup to Socrates’ fingers—what small textures or gestures appear in this handoff?',
      ],
      snippetIds: ['wiki:the_death_of_socrates:0:0', 'wiki:socrates:1:0'],
    },
    {
      elementId: 'discarded_lyre',
      plannerDescription:
        'discarded_lyre — the discarded lyre and shackles near the edge of the scene.',
      focusDetail:
        'Point out the lyre and shackles lying at the edge and how they signal earthly attachments being left behind [S:wiki:the_death_of_socrates:1:0].',
      prompts: [
        'Near the edge of the scene, what objects do you notice resting on the ground, and how do they contrast with the figures?',
        'Look toward the floor—what stories might the discarded lyre and shackles tell just through their placement?',
      ],
      snippetIds: ['wiki:the_death_of_socrates:1:0'],
    },
    {
      elementId: 'overall_scan',
      plannerDescription:
        'overall_scan — survey of the full composition, benches, and stark setting that frames the event.',
      focusDetail:
        'Summarize the stark interior, geometric benches, and overall arrangement that steady the drama [S:wiki:the_death_of_socrates:1:0].',
      prompts: [
        'Take in the whole scene for a moment—what detail stands out first as you scan from LEFT to RIGHT?',
        'If you begin at the far LEFT and move slowly to the RIGHT, how do the light and geometry shift across the space?',
      ],
      snippetIds: ['wiki:the_death_of_socrates:1:0'],
    },
  ],
};

export function listSlowLookingElements(
  artifactId: string
): { elementId: string; description: string }[] {
  return (PROMPT_LIBRARY[artifactId] ?? []).map((entry) => ({
    elementId: entry.elementId,
    description: entry.plannerDescription,
  }));
}

interface SelectPromptOptions {
  artifactId: string;
  availableSnippetIds: string[];
  targetElements?: string[];
  preferredElements?: string[];
  excludeElements?: string[];
  recentPrompts?: string[];
}

export function selectSlowLookingPrompt({
  artifactId,
  availableSnippetIds,
  targetElements,
  preferredElements,
  excludeElements,
  recentPrompts,
}: SelectPromptOptions): SelectedSlowLookingPrompt | null {
  const entries = PROMPT_LIBRARY[artifactId];
  if (!entries || entries.length === 0) {
    return null;
  }

  const available = new Set(availableSnippetIds);
  const excludeSet = new Set(excludeElements ?? []);
  const recentPromptSet = new Set(recentPrompts ?? []);

  const candidateOrder = [
    ...(preferredElements ?? []),
    ...(targetElements ?? []),
    ...entries.map((entry) => entry.elementId),
  ];

  const requestedOrder = candidateOrder.filter((elementId, index) => {
    if (!elementId) {
      return false;
    }
    return candidateOrder.indexOf(elementId) === index;
  });

  const pickFromList = (
    candidateIds: string[]
  ): SelectedSlowLookingPrompt | null => {
    for (const elementId of candidateIds) {
      const entry = entries.find((item) => item.elementId === elementId);
      if (!entry) {
        continue;
      }
      if (excludeSet.has(entry.elementId)) {
        continue;
      }
      const hasSnippetSupport = entry.snippetIds.some((id) =>
        available.has(id)
      );
      if (hasSnippetSupport) {
        const prompt = entry.prompts.find(
          (variant) => !recentPromptSet.has(variant)
        );
        if (!prompt) {
          continue;
        }
        return {
          elementId: entry.elementId,
          focusDetail: entry.focusDetail,
          prompt,
          snippetIds: entry.snippetIds,
        };
      }
    }
    return null;
  };

  const fromRequested = pickFromList(requestedOrder);
  if (fromRequested) {
    return fromRequested;
  }

  return pickFromList(entries.map((entry) => entry.elementId));
}

export function formatSlowLookingElementsForPlanner(
  artifactId: string
): string {
  const elements = listSlowLookingElements(artifactId);
  if (elements.length === 0) {
    return '(no slow-looking prompts registered for this artwork)';
  }

  return elements
    .map((item) => `${item.elementId}: ${item.description}`)
    .join('; ');
}

export function findElementIdForPrompt(
  artifactId: string,
  prompt: string
): string | null {
  const entries = PROMPT_LIBRARY[artifactId];
  if (!entries) {
    return null;
  }
  const normalized = prompt.trim();
  for (const entry of entries) {
    if (entry.prompts.some((candidate) => candidate === normalized)) {
      return entry.elementId;
    }
  }
  return null;
}
