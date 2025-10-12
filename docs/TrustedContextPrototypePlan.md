# Trusted Context Prototype Plan

Prototype goal: demonstrate that richer, trustworthy chat experiences emerge when artwork metadata and visual descriptions are combined with pre-approved encyclopedic sources (Wikipedia/Wikidata—additional vocabularies can be layered in later) — all processed offline and without human review.

## Inputs & Assumptions
- Existing structured metadata per artwork (title, artist, date, medium, accession number).
- Generated visual descriptions for each artwork (already available in the project).
- Offline access to vetted corpora:
  - Wikipedia/Wikidata extracts for the small set of relevant entities.
- No human-in-the-loop editing; quality must come from automated checks.
  - (Optional future work) Getty vocabularies can be added once licensing and coverage are confirmed.

## End-to-End Pipeline

1. **Assemble Trusted Corpora (Offline)**
   - Export page bundles for the target artworks, their creators, and related entities from Wikipedia/Wikidata using known IDs; store as JSON or Markdown with metadata (page id, title, section hierarchy).
   - Use `npx tsx scripts/trusted_context/fetch-wikipedia.ts --suggestions data/trusted_corpus/suggestions/<artifact_id>.json` to download and normalize Wikipedia extracts (the script automatically retries with the top search result when a suggested title does not exist).
   - Record immutable source identifiers and timestamps so every snippet has provenance.

2. **Normalize Artwork Metadata**
   - Consolidate the existing metadata into a canonical schema (`artifact_id`, `title`, `artist_id`, `wikidata_id`, external_ids[], `medium`, `dimensions`, `created_date`, etc.).
   - Ensure every artwork references its artist and known external IDs where possible; fall back to a `needs_id_resolution` flag if linking fails.

3. **Ingest Visual Descriptions**
   - Attach the generated visual description text to the schema (`visual_description` field).
   - Tokenize and chunk descriptions (e.g., 150–200 token segments) to support downstream retrieval.

4. **Discover Candidate Related Entities**
   - Run the suggestion CLI (`npx tsx scripts/trusted_context/suggest-links.ts --artifact-config data/trusted_corpus/artifacts/<artifact_id>.json`) to let Gemini propose Wikipedia/Wikidata entities grounded in the artwork metadata + visual description. The script writes structured output to `data/trusted_corpus/suggestions/<artifact_id>.json`.
   - Require the model to output structured suggestions (`label`, `category`, `wikipedia_title`, `wikidata_id`, `reason`, `confidence`, `evidence`) so we know which part of the input triggered the recommendation.
   - Treat the result as a proposal list—only entities that can be resolved to approved IDs move forward.

5. **Resolve Entity Suggestions to Trusted IDs**
   - Match suggestions against the vetted corpora using exact-title matches, alias tables, or embeddings constrained to the known ID sets.
   - Discard suggestions with no match; mark ambiguous matches for automatic rejection to avoid hallucinated links.
   - Produce a `related_entities` list referencing the resolved Wikidata IDs only (additional vocabularies can be added later).

6. **Harvest Source Snippets**
   - For each resolved entity, extract relevant sections from the offline corpora (intro paragraphs, thematic sections, timelines).
   - Chunk the text (e.g., 120–180 tokens) and attach metadata: `entity_id`, `source`, `section_title`, `citation_reference`.
   - Store snippets in an indexable format (JSONL) to support retrieval and citation.

7. **Build Context Capsules**
   - Assemble a structured capsule per artwork with the following sections:
     - `core_facts`: key-value facts sourced from metadata/Wikidata (artist, date, medium, dimensions).
     - `summary`: LLM-generated narrative constrained to retrieved snippets (require citations for each sentence).
     - `timeline`: ordered events derived from metadata and source snippets.
     - `glossary`: short definitions of critical terms or figures.
     - `related_entities`: resolved IDs with brief descriptions.
   - Use a retrieval-augmented LLM prompt that forbids inventing content and enforces one or more snippet citations per statement.
   - Generate the bundle and snippet JSONL with `node scripts/trusted_context/build-capsule.mjs --artifact-config data/trusted_corpus/artifacts/<artifact_id>.json`.
    - Optional curated notes: drop Markdown/text files into `data/trusted_corpus/manual/` and add a document entry in the artifact config with `"format": "markdown"` to ingest them as first-class snippets.
   - Produce snippet embeddings with Jina via `npx tsx scripts/trusted_context/embed-snippets.ts --input data/trusted_corpus/snippets/<artifact_id>.jsonl` (writes `<artifact_id>.with_embeddings.jsonl`).
   - Index the embedded snippets with `node scripts/trusted_context/index-snippets.mjs --artifact <artifact_id> --recreate` or point `--snippets` at the `.with_embeddings.jsonl` file (set `ELASTICSEARCH_KNOWLEDGE_INDEX` or accept `knowledge_snippets`).

8. **Automated Review Pass**
   - Run a second LLM validator prompted to verify:
     - Every statement carries at least one citation referencing the approved snippets.
     - Required fields (artist, date, medium) match the canonical metadata exactly.
     - No forbidden topics or uncited facts appear.
   - Reject or regenerate sections that fail validation; repeat until the validator returns `approved=true`.

9. **Package & Store Capsules**
   - Persist capsules as versioned JSON files (`capsules/<artifact_id>.json`) containing:
     - `metadata`, `visual_description_chunks`, `capsule_sections`, `snippet_index`.
     - Build-time metadata (pipeline version, timestamps, hashes of source files).

10. **Integrate with Chat Runtime**
    - On each user query, retrieve top-matching snippets from the capsule (semantic + keyword search).
    - Invoke the conversational LLM with the system prompt + retrieved snippets + capsule facts; enforce citation tags in responses.
    - If retrieval returns nothing relevant, respond with an in-character deflection citing scope limitations.
   - API helper: `POST /api/knowledge-search` accepts `{ artifactId, query, size? }`, resolves the query embedding with Jina text embeddings, and returns the top snippets with citation metadata for prompt construction.

11. **Automated Regression Checks**
    - Create a small suite of scripted questions per artwork (facts, adversarial prompts) to ensure responses stay within the capsule and cite approved snippets.
    - Run the suite whenever capsules or prompts change; treat failures as blockers.

## Deliverables
- `data/trusted_corpus/` — normalized source files (Wikipedia/Wikidata; Getty vocabularies can be layered in later).
- `data/artifacts.json` — canonical metadata with external IDs and visual descriptions.
- `capsules/<artifact_id>.json` — context capsules with citations and build metadata.
- `scripts/` — automation for suggestion generation (`suggest-links.ts`), Wikipedia mirroring (`fetch-wikipedia.ts`), capsule generation (`build-capsule.mjs`), snippet embedding (`embed-snippets.ts`), snippet indexing (`index-snippets.mjs`), validator pass, and regression tests.

## LLM Suggestion CLI
- Command: `npx tsx scripts/trusted_context/suggest-links.ts --artifact-config data/trusted_corpus/artifacts/<artifact_id>.json`
- Requires: `GOOGLE_GEMINI_API_KEY` (or `GEMINI_API_KEY`) loaded from your `.env` files; set `GEMINI_MODEL` to override the default `gemini-2.5-flash`.
- Outputs: `data/trusted_corpus/suggestions/<artifact_id>.json` containing structured proposals (`label`, `category`, `wikipedia_title`, `wikidata_id`, `reason`, `confidence`, `evidence`).
- Typical flow: run the CLI → review/resolve IDs → update `artifact_config.documents` with the approved entries → rebuild capsule.
- Dependencies: install `@google/generative-ai` (`npm install @google/generative-ai`) before invoking the CLI; the script auto-loads `.env.local` and `.env` at repo root.

## Next Steps
1. Prototype the pipeline for “The Death of Socrates” end to end.
2. Generalize scripts to handle multiple artworks from the dataset.
3. Integrate the capsule-backed retrieval flow into the chat UI for a live demo.
