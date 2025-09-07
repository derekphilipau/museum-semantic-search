# Claude Context - Museum Semantic Search

## Important Configuration

### Gemini Model
**ALWAYS USE: `gemini-2.5-flash`**
- NOT `gemini-2.0-flash-exp`
- NOT `gemini-1.5-pro`
- The project uses `gemini-2.5-flash` for all description generation and editing

### Project Structure
- Description generation: `scripts/met/generate-descriptions-to-file-met.ts`
- Description editing: `scripts/met/edit-descriptions-met.ts`
- Gemini integration: `lib/descriptions/gemini.ts`

### Key Design Decisions
1. **ID-based idempotency**: Scripts scan existing JSONL files to skip already-processed artworks
2. **No progress.json**: Removed in favor of ID-based tracking
3. **No --force option**: Never delete existing work
4. **Immediate writes**: Each record saved immediately after processing
5. **Retry logic**: 3 attempts with exponential backoff for API failures

### Common Issues
- Empty responses from Gemini: Usually rate limiting or API quota issues
- 503 Service Unavailable: "The model is overloaded" - wait and retry later
- Content blocked: Some artworks trigger safety filters (nudity, etc.)
- Missing images: Some Met URLs return 404

### When Gemini is Overloaded
- Try during off-peak hours (early morning, late night)
- Use smaller batch sizes: `npm run edit-descriptions-met -- --batch-size 10`
- Process specific artworks: `npm run edit-descriptions-met -- --artwork-ids met_12345`