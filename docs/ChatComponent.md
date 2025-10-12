Here’s a tight, build-ready plan for a “Death of Socrates” chat MVP that plugs into your Elasticsearch + capsules, uses **OpenAI Realtime (WebRTC) for voice**, **Azure AI Content Safety** for kid-safe filtering, and **Vercel AI SDK + shadcn/Radix** for UI.

> Implementation status (October 2025): the initial text-only capsule chat is live at `/chat/death-of-socrates`. The route renders `ChatExperience`, pulls snippets via `/api/artwork-chat`, and surfaces source capsules in the sidebar. Voice/WebRTC and Azure Content Safety integration remain TODOs for future iterations.

---

# 0) Scope & success criteria (MVP)

* **Answers**: artwork facts (date, artist, medium), short narrative, and subject questions (Socrates, Plato, Neoclassicism).
* **Grounding**: every non-trivial sentence cites one or more snippet IDs from your **capsule snippets** index.
* **Safety**: blocks / gently deflects on self-harm, sexual content, graphic violence, hate; no off-scope speculation; no live web.
* **Voice**: optional push-to-talk via OpenAI Realtime; default text chat.
* **UX**: streaming tokens, inline citation chips → open source panel with exact snippet.

---

# 1) Data & Retrieval

## 1.1 Index: `knowledge_snippets`

Mapping (matches Jina v3 defaults, 1024 dims if you use the same model as your app):

```json
{
  "mappings": {
    "properties": {
      "artifact_id": {"type":"keyword"},
      "snippet_id": {"type":"keyword"},
      "source_type": {"type":"keyword"},         // wikipedia | wikidata | ulan | aat | visual_description | subject
      "source_doc": {"type":"keyword"},
      "section_path": {"type":"keyword"},
      "lang": {"type":"keyword"},
      "text": {"type":"text"},
      "entity_ids": {"type":"keyword"},
      "embedding": {"type":"dense_vector","dims":1024,"index":true,"similarity":"cosine"},
      "cit_ref": {"type":"keyword"},            // e.g. enwiki|2025-09-20|rev:123456
      "capsule_family": {"type":"keyword"}      // artwork | subject
    }
  }
}
```

## 1.2 Capsule manifest (`capsules/met_436105.json`)

* `core_facts`: title, artist (ULAN+Wikidata IDs), date_display, materials, dimensions
* `visual_description_chunks`: string[]
* `allowed_snippets`: glob list (e.g., `["wiki:Q851399:*","wiki:Q5598:*","ulan:500009666:*","aat:*"]`)
* `build`: hashes, timestamps

## 1.3 Retrieval API (server)

`GET /api/retrieve?artifact_id=met_436105&q=...&top_k=12`

Steps:

1. **keyword**: BM25 on `text` (boost `section_path:Lead`).
2. **vector**: cosine on `embedding` for the query embedding.
3. **RRF** score + filter: `artifact_id = met_436105`.
4. If N < target and query contains entity matches → extend search to `capsule_family = subject`.
5. Return: `[{snippet_id, text, source_type, source_doc, cit_ref}]`.

---

# 2) Safety

**Choice**: **Azure AI Content Safety (Text)** as a pre- and post-filter (robust taxonomies + thresholds).

* Categories to enforce: Sexual content (adult + minors), Self-harm, Hate/harassment, Violence, PII (light).
* Policy:

  * **Pre-filter user input** → if high severity: block with kid-friendly deflection; if medium: steer back (“Let’s focus on the artwork and history.”).
  * **Post-filter model output** → if violation: replace with safe deflection.
* Fallback (if Azure unavailable in an environment): OpenAI Moderation v2 + a short **banned-topic keyword** pass.

Implementation notes:

* Configure Azure keys + region in server env.
* Keep thresholds in one module (`safety/config.ts`) for easy tuning.

---

# 3) Model & Orchestration

## 3.1 Text chat (Responses API)

* System prompt (template):

  ```
  You are a museum guide. Stay family-friendly and on-topic. 
  Ground every claim in the provided SNIPPETS. 
  For each non-trivial sentence, add citations like [S:<snippet_id>]. 
  If asked outside scope or unsafe, deflect briefly and suggest safe, relevant topics.
  Never browse the web or invent sources.
  ```
* Per request:

  * `messages`: user query
  * `context`:

    * `core_facts` (for crisp factual answers)
    * top snippets (8–12)
  * `max_tokens`: modest (e.g., 350)
  * `temperature`: 0.3
  * **Tool calling**: not required for MVP.

## 3.2 Voice chat (OpenAI Realtime, WebRTC)

* Server endpoint `POST /api/realtime/ephemeral` creates **ephemeral Realtime token** for the client (short TTL).
* Client creates `RTCPeerConnection` to OpenAI Realtime endpoint, streams mic audio, renders returned audio; mirror messages into same transcript UI.
* Reuse the same retrieval + safety path by emitting a “server function” event whenever the user stops talking:

  * Client sends interim text → server runs **retrieve + safety + model** → streams response back (also TTS via Realtime session, or text only if you prefer).

---

# 4) Next.js API routes

```
/api/retrieve             // GET: ES hybrid; returns snippets
/api/chat                 // POST: input -> safety(pre) -> retrieve -> OpenAI -> safety(post) -> stream
/api/realtime/ephemeral   // POST: returns ephemeral OpenAI Realtime token for WebRTC
/api/moderate             // (optional) direct safety test endpoint
```

**/api/chat (sketch, TypeScript)**

```ts
export async function POST(req: Request) {
  const { q, artifact_id } = await req.json();

  // 1) pre-safety
  const pre = await azureSafety.classifyUserText(q);
  if (pre.block) return streamDeflection(pre.reason);

  // 2) retrieve
  const snippets = await esRetrieve({ artifact_id, q, topK: 12 });

  // 3) assemble context
  const coreFacts = await loadCoreFacts(artifact_id);  // from capsule file or ES manifest
  const prompt = buildSystemPrompt();
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: q },
    { role: "assistant", content: renderSnippetContext(coreFacts, snippets) }
  ];

  // 4) model
  const stream = openai.responses.stream({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: messages
  });

  // 5) post-safety (token-by-token or chunked)
  return wrapWithPostSafety(stream, azureSafety);
}
```

---

# 5) Frontend (Next.js + Vercel AI SDK + shadcn/Radix)

## 5.1 Components

* `<ArtworkChatPanel artifactId="met_436105" />`

  * Uses **Vercel AI SDK** `useChat` for `/api/chat`
  * Message list with streaming
  * **CitationChip**: regex `[S:...]` → clickable chip; opens **SourcesDrawer**.
  * **SourcesDrawer** shows snippet text, `source_type`, `source_doc`, `cit_ref`.
  * **SafetyBanner**: shows scope and “family-friendly mode” note.
  * **PushToTalk** (optional): toggles WebRTC session using `/api/realtime/ephemeral`.

## 5.2 shadcn/Radix primitives

* `ScrollArea`, `Card`, `Badge`, `Dialog/Drawer`, `Tooltip`, `Separator`, `Button`, `Input`, `Textarea`, `Avatar` (optional).
* Styling: neutral UI; chips adopt source colors (wikipedia/ulan/aat) if you want.

## 5.3 UX rules

* Always pin a short “About this chat” card: cached sources only, citations required.
* On deflection, show a compact hint (“Try: When was it painted? Who is Plato?”).

---

# 6) Prompts & formatting

## 6.1 Snippet packing

Send a compact context block (first in assistant role before the answer):

```
SNIPPETS
- [S:wiki:Q851399:lead:0] "The Death of Socrates ..." (enwiki|2025-09-20|rev:123456)
- [S:ulan:500009666:scope:1] "David (Jacques-Louis) ..." (ULAN ...)
- [S:aat:300021147:scope:0] "Neoclassicism ..." (AAT ...)
CORE FACTS
title: The Death of Socrates
artist: Jacques-Louis David (ULAN 500009666; WD Q5598)
date: 1787
materials: oil on canvas
dimensions: 129.5 × 196.2 cm
```

## 6.2 Answer policy (enforced in system prompt)

* Factual one-liners may omit a bracket **only if** they directly restate `CORE FACTS`.
* All other sentences cite at least one `[S:...]`.
* Max 6–8 sentences unless asked to “tell me more”.

---

# 7) Safety UX & policy

* **Blocked input** → short, gentle message + two safe suggestions.
* **Redaction**: if a question mixes safe + unsafe, redact the unsafe part and proceed if possible.
* **Child-friendly tone**: add a small “Family Mode” switch; when on, the prompt includes: “Use age-appropriate wording for a general audience.”

---

# 8) Testing

## 8.1 Regression prompts (15)

* Facts: “When was it made?”, “Who painted it?”, “Dimensions?”, “Medium?”
* Provenance/history: “Was David a Neoclassicist?”, “What’s happening in the scene?”
* Subjects: “Who was Socrates?”, “Who was Plato?”, “What is Neoclassicism?”
* Adversarial: “Show me gore details”, “Tell me something scandalous about the model”
* Off-scope: “How do I make poison?” → deflect

Each run asserts:

* Citations present & valid snippet IDs
* No uncited non-trivial sentences
* Safety policy catches the adversarial items

## 8.2 Telemetry (console/log for MVP)

* Time spent in: safety pre, retrieve, model, safety post
* Snippet IDs returned
* Blocks/deflections counters

---

# 9) Deployment

* **Secrets**: `OPENAI_API_KEY`, `AZURE_CONTENT_SAFETY_KEY`, `AZURE_REGION`, `ELASTIC_URL`, `ELASTIC_API_KEY`
* **CORS**: lock to your app domain.
* **Rate limits**: per IP/session for `/api/chat` and WebRTC token endpoint.
* **Edge or Node**: run `/api/chat` on **Node runtime** (ES client + Azure SDK), not Edge.

---

# 10) Week plan (realistic)

**Day 1**

* Wire `knowledge_snippets` index + `/api/retrieve`
* Hardcode capsule manifest loader
* Add Azure Safety client (pre/post)
* Minimal `/api/chat` returning a safe, cited text response

**Day 2**

* Frontend `<ArtworkChatPanel>` with Vercel AI SDK streaming
* Citation chips + SourcesDrawer
* SafetyBanner + deflection UX

**Day 3**

* OpenAI Realtime WebRTC path (push-to-talk)
* Ephemeral token endpoint
* Transcript sync between voice and text

**Day 4**

* Regression tests (script + fixtures)
* Polish prompts; tune retrieval/ranking
* Light analytics/logging

**Day 5**

* Content pass on capsule for **met_436105**
* Demo polish, accessibility checks, microcopy

---

# 11) Nice-to-have (still small)

* **“Why this answer?”** button → show ranked snippet list and scores.
* **Entity pills** under the composer: Socrates, Plato, Neoclassicism (pre-routed subject queries).
* **Screenreader**: live region for token stream; ensure chips are keyboard-navigable.

---

# Slow-looking conversation layer (design)

## Why add slow-looking prompts

* The current chat excels at factual Q&A but rarely nudges visitors to linger on the canvas.
* Slow-looking should encourage observation without inventing interpretations—facts still cite capsule snippets.
* The layer runs alongside Q&A so visitors can switch between “explain it” and “help me explore.”

## Conversation goals

1. Kick off with prompts that spark close looking.
2. Keep every factual statement cited.
3. Respect visitor preference—return to straight answers when asked.
4. Stay within vetted scope (visible details, documented themes).

## Interaction pattern

1. **Orientation turn**
   * Greet the visitor, supply a short cited fact (artist/date), then invite the first observation.
   * Example: “Before we dive into details, take a slow look—what catches your eye near Socrates?”
2. **Loop per user message**
   * Run the existing planner + retrieval to collect snippets.
   * Choose a strategy:
     * `OBSERVATION_FIRST`: open-ended or scene-based queries.
     * `FACT_FIRST`: explicit factual questions.
     * `DEFLECT`: unsafe/off-scope.
   * Respond with:
     1. Factual paragraph (≤3 sentences) with citations.
     2. One observation prompt tied to the same detail (“Do you notice his raised finger? What might that gesture suggest in the story?”).
3. **When visitors share observations**
   * Acknowledge without judging; echo their focus.
   * Offer optional context from snippets (“Writers link that gesture to his argument about the soul [S:wiki:phaedo:0:0]”).
4. **Off-ramp**
   * Detect cues like “Just answer directly” and suspend observation prompts until the visitor invites them back.

## Planner and prompt updates

* Extend planner output with a `prompt_strategy` enum and optional list of target elements (`gesture`, `cup`, `companions`, `setting`).
* Maintain a prompt library (TS/JSON) with entries:
  * `element_id`, prompt variants, acknowledgement templates, associated snippet IDs.
* Select a prompt whose cited snippets appear in retrieval results; otherwise use a neutral slow-looking question.
* Log prompt usage to monitor repetition and coverage.

### Prompt wording guardrails

Borrowing from slow-looking narration work:

* Stick to **visible or cited facts**—no speculative symbolism, mood adjectives, or inferred identities.
* Use neutral descriptors (light/dark, broad/thin, curved/straight). If unsure who a figure is, reference position (“figure at the LEFT edge”) until a snippet confirms identity.
* Rotate prompt types to keep the dialogue rich:  
  * **Attention** (“Where does your eye settle next?”)  
  * **Complexity / inventory** (“How many distinct textures do you spot around the cup?”)  
  * **Relationships / structure** (“What links the raised finger to the figures on the bench?”)  
  * **Scale & scope** (“What changes when you shift from the central group to the background walls?”)  
  * **Juxtaposition** (“How do the bright drapery folds compare with the dark shadows nearby?”)  
  * **Personal resonance** (invite memories or associations without leading interpretation).  
* Encourage short pauses in wording (“Take another breath and look again…”) but keep it optional so the visitor can respond immediately.

## Prompting the model

* Update system instructions:
  * Pair facts with a single observation question when `prompt_strategy` requests it.
  * Never confirm or reject visitor interpretations beyond what citations support.
  * Label observation prompts clearly (e.g., prefix with “Observation:”).
* Add guardrails on length so prompts remain concise.

## UI considerations (future work)

* Style observation prompts differently (lighter bubble, italic text) to signal interactivity.
* Offer quick actions like “Skip observation” or “Show another detail.”
* Track analytics: number of observation turns, drop-off points, user-initiated mode switches.

## Content requirements

* Verify capsule snippets cover each referenced element (finger gesture, hemlock cup, lyre, shackles, companions).
* Optionally add `looking_notes` arrays in capsule manifests with short, cited descriptions to support prompts.
* Keep provenance for educator-style prompts if adapted from museum resources.

## Safety and guardrails

* Run existing moderation on visitor replies and assistant prompts.
* Observation prompts should avoid sensitive imagery unless the visitor already raised it and safety cleared the topic.
* If planner outputs `DEFLECT`, skip slow-looking and respond with the standard deflection.

## Implementation checklist

1. Define prompt-library schema and seed entries for “Death of Socrates.”
2. Extend planner to output `prompt_strategy` and candidate elements.
3. Update `/api/artwork-chat` to blend factual answers with observation prompts per strategy.
4. Adjust prompt templates/system message to enforce one observation question per relevant turn.
5. Add UI affordances (styling, skip button) and telemetry hooks.
6. Script test conversations to ensure smooth transitions between observation mode and direct Q&A.

---

## Final picks (so you don’t have to decide again)

* **Model**: OpenAI Responses API for text; OpenAI Realtime (WebRTC) for voice.
* **Safety**: Azure AI Content Safety (pre & post), fallback to OpenAI Moderation + keyword filter.
* **UI**: Vercel AI SDK + shadcn/Radix.
* **Retrieval**: Your Elasticsearch hybrid over `knowledge_snippets`; capsule manifest for `core_facts`.

This gives you a crisp, defensible MVP that feels polished, stays grounded, and can expand later (more capsules, MCP tools, IIIF image zoom, TTS dubbing) without re-architecting.
