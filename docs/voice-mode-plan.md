# Voice Mode (Chained) – Design Plan

## Goals
- Add an opt-in voice experience that keeps the existing grounded chat flow intact.
- Maintain full visibility into transcripts, retrieved snippets, and inline citations.
- Use OpenAI services we already provision (`gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`, and `gpt-5-mini` for the chat turn) so we avoid running extra infrastructure.
- Keep the MVP simple: no realtime streaming yet, but design with a path to upgrade later.

## Constraints & Guardrails
- **Citation control:** voice answers must still come from `/api/artwork-chat`, so every factual sentence keeps `[S:…]` citations.
- **Observation prompts:** the slow-looking planner remains in charge; voice output only paraphrases the text reply (no extra questions).
- **No hallucinated context:** the voice layer cannot query external sources; it simply reuses the snippets already retrieved.
- **Latency budget:** aim for <3 s round trip (record upload + transcription + chat + TTS). MVP will serialize steps; later we can pipeline.
- **Browser only:** first release targets the existing Next.js client. No telephony or server-side recording yet.

## High-Level Flow
1. **User toggles “Voice mode”.**
2. **Record clip** with `MediaRecorder` (WebM/Opus, ~16 kHz) while the user holds the mic button.
3. **Send clip to `/api/voice-chat`** along with the current chat history (same shape as today) and the `artifactId`.
4. **Server sequence**:
   - Validate input, ensure voice mode is available for the requested artifact.
   - Transcribe with OpenAI `gpt-4o-mini-transcribe`, returning normalized text plus timestamps (keep for future diarization if needed).
   - Append the transcription as the latest user message; call existing `runCapsuleChat()` utility (wrapper around `/api/artwork-chat`, now powered by `gpt-5-mini`) to produce the grounded response.
   - Request TTS via `gpt-4o-mini-tts` using the assistant text. Strip `[S:…]` before synthesis, but keep them in the JSON payload for the UI.
   - Respond with JSON: `{ transcript, chat, audio: { mimeType, base64Data }, snippets, retrievalLog }`.
5. **Client updates UI**:
   - Insert the transcript as a user message (tagged as voice).
   - Render the assistant text with citations as today.
   - Play the returned audio via an `<audio>` element; show a play/pause control near the assistant bubble.
   - Continue to display retrieval details/snippet chips.
6. **Error cases**:
   - If transcription fails: surface error and keep audio for retry.
   - If chat call fails: show same error handling we already have (`Search failed…`), skip TTS.
   - If TTS fails: still render text reply and offer “Play unavailable” copy.

## API Shape Proposal
- **Route:** `POST /api/voice-chat`
- **Request body (JSON + multipart)**:
  ```http
  Content-Type: multipart/form-data
  fields:
    - artifactId: string
    - messages: JSON string (array of `{ role, content }`)
    - audio: binary (single recorded chunk)
  ```
  Using multipart avoids base64 inflation and simplifies future streaming.
- **Response (JSON)**:
  ```json
  {
    "transcript": { "text": "...", "durationMs": 2840 },
    "message": { "role": "assistant", "content": "…[S:...]" },
    "snippets": [...],
    "retrievalLog": [...],
    "audio": { "mimeType": "audio/mpeg", "base64": "..." }
  }
  ```

## Client Responsibilities
- Manage recording state: idle → recording → processing → ready.
- Keep the composer disabled while processing to avoid simultaneous text submits.
- Display live status (“Transcribing…”, “Synthesizing audio…”) using the existing system-message pattern.
- Allow the user to cancel/skip audio playback (stop the `<audio>` element).
- Persist transcript text in the message array so the conversation history matches what the server saw.

## Server Utilities Needed
- `lib/audio/openai.ts`: helper functions to call transcribe/TTS endpoints with retry and error normalization.
- `lib/voice/normalize-transcript.ts`: convert OpenAI transcript to our `ChatMessageInput`.
- `lib/voice/extractSpokenText.ts`: remove `[S:…]` tags before TTS while keeping bracketed note of citations for UI (`[S:xxx]` → spoken “source S colon xxx” is *not* needed).

## Environment Variables
- `OPENAI_API_KEY` (already expected elsewhere, but document again).
- Optional: `OPENAI_TTS_VOICE` to switch among available voices.

## Testing Approach
- Unit test transcript normalization.
- Mock OpenAI client to exercise success and failure paths in `/api/voice-chat`.
- Browser manual test: verify repeated voice turns, skip observation prompts in “facts only” mode, ensure citations persist.

## Future Enhancements (Out of Scope for MVP)
- Progressive upload or recorder streaming to reduce latency.
- Gesture/observation-aware prosody (e.g., choose different TTS voices).
- Persist voice preference per session via cookies or KV.
- Upgrade to Realtime speech-to-speech once guardrails are rock solid.
