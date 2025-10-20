## Chat + Search Integration Plan

### 1. Current Search Surface
- **Index**: `artworks_semantic` (default from `ELASTICSEARCH_INDEX`).
- **Summary fields** returned in search helpers: `id`, `title`, `artist`, `date`, `medium`, `classification`, `department`, `collection`, `image`, `visual_description.{emoji_summary, alt_text}`.
- **Existing helpers** (`lib/elasticsearch/client.ts`):
  - `performKeywordSearch(query, size, includeDescriptions?)`
  - `performEmojiSearch(emojis[], size?)`
  - `performTagSearch(tags[], size?, matchAll?)`
  - `performSemanticSearchWithEmbedding(vector, model, size?)`
  - `performHybridSearchWithEmbeddings({ keyword, embeddings, balance, size })`
  - `performSimilaritySearchByIds(ids[], size?, overrides?)`
  - `performSimilaritySearchByImage(vector, size?)`
  - Index stats + projection utilities already available via `app/api/search/*`.

### 2. Facets & Search Modes To Expose First
- **Facet-based** (exact / keyword filters):
  - `constituent` (artist / maker) via `artist.keyword` field or `artists[].id`.
  - `classification.keyword` (e.g., Painting, Sculpture).
  - (Optional) `department.keyword`, `culture.keyword`, `tags` if available.
- **Semantic**:
  - Text embeddings (`jina_text`) for “paintings with cats” style queries.
  - Existing CLIP / image embedding hooks can stay opt-in.

### 3. Library Layer (non-chat)
- Add a dedicated module, e.g., `lib/search/artworks.ts`, with focused helpers:
  ```ts
  searchArtworksByConstituent({ artistId, size }): Promise<ArtworkHit[]>
  searchArtworksByClassification({ classification, size }): Promise<ArtworkHit[]>
  searchArtworksBySemanticText({ text, size }): Promise<ArtworkHit[]>
  ```
- Each helper:
  - Calls the existing low-level ES helpers (keyword / semantic).
  - Normalizes results to `{ id, title, artist, thumbnailUrl, score }`.
  - Hides raw ES query building from consumers (chat, API, UI).
- Include shared typings (`ArtworkHit`, `SearchToolResult`) and constants for default sizes.

### 4. Chat Runtime Integration
- **Tool schema**: describe each helper as a “tool” the LLM can call (name, description, required params).
- **Decision logic**:
  1. Planner detects intent from user query (e.g., matches patterns like “other paintings by …”, “show me works with …”).
  2. Decide between facet search or semantic search:
     - If query mentions a known artist entity → `searchArtworksByConstituent`.
     - If query mentions classification / medium → `searchArtworksByClassification`.
     - Otherwise, free-form subject → `searchArtworksBySemanticText`.
  3. Enforce scope guardrails (only search if the entity is related to the current capsule or explicitly in the query).
- **Execution flow**:
  - Call the helper.
  - If results exist, pass back both:
    - Factual answer grounded in snippets (as today).
    - Structured `relatedArtworks` array for the UI.
  - If no results, answer with grounded text and a brief “no related works found” message (still citing snippets).

### 5. UI & Response Contract
- Extend chat API response payload:
  ```ts
  interface ChatResponsePayload {
    message: { role: 'assistant'; content: string };
    snippets: KnowledgeSnippet[];
    retrievalLog?: RetrievalLogEntry[];
    relatedArtworks?: Array<{
      id: string;
      title: string;
      artist?: string;
      thumbnailUrl?: string;
    }>;
  }
  ```
- Update `/chat/[artifact]/ChatExperience.tsx` to detect `relatedArtworks` and render:
  - Horizontal cards with thumbnail, title, artist.
  - Click → existing artwork detail route.
- Maintain existing citation rules for textual answer; search gallery is supplemental.

### 6. Rollout & Testing
- Unit-test new helpers with mocked ES client.
- Add regression prompts (e.g., “show me more paintings by Jacques-Louis David”, “find works with cats”) to ensure:
  - Planner chooses the appropriate tool.
  - Results are surfaced in UI.
  - No search call when capsule alone suffices.
- Monitor logs (request intent, tool name, hit counts) for tuning.

### 7. Open Questions / Next Iteration Ideas
- Should we expose additional facets (materials, period) before launch?
- Do we want pagination / “see more” routes for search results?
- Consider caching frequent facet queries to reduce ES load.

---

## Batch Search API Sketch

To eliminate sequential ES calls from the chat runtime, expose a batch endpoint that accepts multiple tasks and runs them in parallel.

### Request

```jsonc
POST /api/chat-search
{
  "artifactId": "met_436105",
  "fallbackQuery": "who is in the painting",
  "tasks": [
    { "id": "companions", "type": "snippet", "query": "companions around Socrates", "size": 8 },
    { "id": "artist-catalogue", "type": "artwork.constituent", "artistName": "Jacques-Louis David", "size": 6 },
    { "id": "subject-search", "type": "artwork.semantic", "text": "paintings featuring Socrates", "size": 6 }
  ]
}
```

- `type: "snippet"` — knowledge-snippet retrieval (mirrors `retrieveKnowledgeSnippets`).
- `type: "artwork.constituent"` — constituent helper (requires `artistId` or `artistName`; optional `excludeIds`, `size`).
- `type: "artwork.classification"` — classification helper (`classification`, optional `excludeIds`, `size`).
- `type: "artwork.semantic"` — semantic helper (`text`, optional `excludeIds`, `size`).
- `type: "artwork.similar"` — metadata/embedding similarity (`artworkId`, optional `excludeIds`, `size`).
- `fallbackQuery` (optional) lets the service run an extra snippet search when coverage is thin.

### Response

```jsonc
{
  "snippets": [
    {
      "snippetId": "manual:gemini_detailed_description:0:5",
      "artifactId": "met_436105",
      "text": "...",
      "sourceTitle": "Detailed Visual Description (Gemini)",
      "sourceType": "manual",
      "score": 4.2
    }
  ],
  "snippetLog": [
    {
      "taskId": "companions",
      "query": "companions around Socrates",
      "hits": 6,
      "source": "planner",
      "topSnippets": ["manual:gemini_detailed_description:0:5"]
    }
  ],
  "artworks": {
    "artist-catalogue": {
      "results": [
        { "id": "met_123456", "title": "The Oath of the Horatii", "artist": "Jacques-Louis David", "thumbnailUrl": "...", "score": 0.78 }
      ],
      "total": 42
    },
    "subject-search": {
      "results": [
        { "id": "met_7891011", "title": "Socrates Seeking Alcibiades", "thumbnailUrl": "...", "score": 0.66 }
      ],
      "total": 5
    }
  }
}
```

- `snippets` — merged & deduped list, ready for the prompt.
- `snippetLog` — mirrors the retrieval log (task id, hits, top snippets).
- `artworks` — keyed by task id; each entry includes normalized results plus total count.

### Chat Flow With Batch Endpoint
1. Planner proposes snippet tasks and optional artwork tasks.
2. Chat runtime submits all tasks in a single request.
3. Endpoint executes tasks in parallel, merges snippet results, triggers fallback if needed, and returns structured data.
4. Chat runtime feeds snippets into the LLM and renders any artwork results as cards.
