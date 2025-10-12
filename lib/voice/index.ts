export function normalizeTranscript(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function transcriptToChatMessage(text: string) {
  return {
    role: 'user' as const,
    content: normalizeTranscript(text),
  };
}

export function stripCitationsForSpeech(text: string) {
  return text.replace(/\[S:[^\]]+]/g, '').replace(/\s+/g, ' ').trim();
}

export function shouldSkipSpeech(text: string) {
  return !stripCitationsForSpeech(text);
}

