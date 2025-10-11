# Claude Context - Museum Semantic Search

## Important Configuration

### Gemini Model
**ALWAYS USE: `gemini-2.5-flash`**
- NOT `gemini-2.0-flash-exp`
- NOT `gemini-1.5-pro`
- The project uses `gemini-2.5-flash` for all description generation and editing

### Project Structure
- Dataset creation: `scripts/met/1-create-paintings-dataset.ts` - Creates MetPaintingsWithImages.csv
- Description generation: `scripts/met/2-generate-descriptions-met.ts` - Uses MetPaintingsWithImages.csv
- Description editing: `scripts/met/3-edit-descriptions-met.ts`
- Jina text embeddings: `scripts/met/generate-text-embeddings.ts`
- Jina CLIP image embeddings: `scripts/met/generate-image-embeddings.ts`
- Make sure `JINA_API_KEY` is configured and install `sharp` locally before generating image embeddings
- Similar artworks generation: `scripts/met/7-generate-similar-artworks-met.ts`
- Similarity index update: `scripts/met/8-update-similarities-met.ts`
- UMAP projections: `scripts/met/generate-umap-projections.ts` - Generates 2D/3D projections from embeddings
- Elasticsearch indexing: `scripts/met/10-index-artworks.ts` - Final step, indexes all data including projections
- Gemini integration: `lib/descriptions/gemini.ts`

### Key Design Decisions
1. **ID-based idempotency**: Scripts scan existing JSONL files to skip already-processed artworks
2. **No progress.json**: Removed in favor of ID-based tracking
3. **No --force option**: Never delete existing work
4. **Immediate writes**: Each record saved immediately after processing
5. **Retry logic**: 3 attempts with exponential backoff for API failures
6. **Static image cache**: `met_image_urls_cache.jsonl` is treated as a complete, prepopulated list - no API fallback
7. **Edited descriptions priority**: Indexing uses edited_descriptions.jsonl when available, falls back to descriptions.jsonl
8. **Tags support**: Met CSV tags field (pipe-delimited) is parsed into array and indexed as keywords for efficient searching
9. **Pre-computed similarities**: Script 7 queries ES for candidates, uses LLM to filter, saves to similar_artworks.jsonl
10. **Multi-language titles**: Title field can be pipe-delimited for multiple languages; first is primary, all stored in titles array

### Common Issues
- Empty responses from Gemini: Usually rate limiting or API quota issues
- 503 Service Unavailable: "The model is overloaded" - wait and retry later
- Content blocked: Some artworks trigger safety filters (nudity, etc.)
- Missing images: Some Met URLs return 404

### When Gemini is Overloaded
- Try during off-peak hours (early morning, late night)
- Use smaller batch sizes: `npm run edit-descriptions-met -- --batch-size 10`
- Process specific artworks: `npm run edit-descriptions-met -- --artwork-ids met_12345`

### Search Capabilities
- **Tag search**: `performTagSearch(['Portraits', 'Men'])` - find artworks with specific tags
- **Get all tags**: `getAllTags()` - returns all unique tags with counts for building filters
- **Similar artworks**: Pre-computed using LLM filtering of ES candidates
- **Emoji search**: Works with emoji arrays from visual descriptions
- **Multi-artist support**: Artworks can have multiple artists with roles (e.g., "After", "In the manner of")
  - Artists stored as nested array with full metadata
  - Similarity search matches on constituent IDs for precision
