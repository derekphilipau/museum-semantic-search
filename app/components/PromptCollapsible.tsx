'use client';

import { ChevronDown, Info } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

const COOPER_HEWITT_PROMPT = `Generate museum-quality accessibility descriptions for this artwork image.

GENERAL RULES (apply to all descriptions):
- Describe only what is visible, not interpretations or symbolism
- For people: describe appearance without assumptions about identity
- Avoid geographic/cultural labels unless describing specific visible features
- Do not assume geographic origin (e.g. East Asian)
- Use clear, common language (avoid technical jargon)
- Never mention metadata (artist, date) unless visible in the image
- Focus on the artwork's visual content, not the physical condition or mounting of the piece

ALT TEXT (10-20 words):
- One concise phrase capturing the essential visual content
- Start with the most important element
- No ending punctuation

LONG DESCRIPTION (100-300 words):
- Progress from general to specific details
- Follow spatial logic (top-to-bottom, left-to-right, or center-outward)
- Include: colors (common names), composition, sizes, spatial relationships
- Transcribe any visible text exactly

EMOJI SUMMARY (2-8 emojis):
- Select emojis that would help someone quickly understand what they'd see
- Main visual elements in order of importance
- ONE emoji per subject (🧔 not 👨+🧔 for bearded man) or group of subjects
- Focus only on content in the artwork, never include display emojis like 🏛️⚱🎨🖼️
- Avoid color-only emojis like 💛,🔴,🟦 unless color is the primary subject
- Choose specific over generic (🌲🌊⛰️ not 🏞️)`;

export default function PromptCollapsible() {
  return (
    <Collapsible className="mt-4">
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-auto p-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Info className="w-3 h-3 mr-1" />
          View AI Prompt
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <div className="rounded-lg bg-muted/50 p-4">
          <h4 className="text-xs font-semibold mb-2">Prompt used for AI generation:</h4>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {COOPER_HEWITT_PROMPT}
          </pre>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
            This prompt follows the{' '}
            <a
              href="https://www.cooperhewitt.org/cooper-hewitt-guidelines-for-image-description/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Cooper Hewitt Guidelines for Image Description
            </a>
            , ensuring museum-quality accessibility descriptions that are objective, 
            detailed, and useful for all visitors.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}