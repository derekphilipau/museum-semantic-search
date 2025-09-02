import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs/promises';

export interface VisualDescription {
  altText: string;
  longDescription: string;
  emojiSummary: string;
}

export interface DescriptionResult {
  descriptions: VisualDescription;
  model: string;
  timestamp: string;
}

// Initialize Gemini client
let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEMINI_API_KEY not configured');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

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

// Define the JSON schema for structured response
const descriptionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    altText: {
      type: SchemaType.STRING,
      description: '10-20 word objective summary of visual content, no metadata unless visible in image'
    },
    longDescription: {
      type: SchemaType.STRING,
      description: '100-300 word neutral visual description without interpretation or assumed meaning'
    },
    emojiSummary: {
      type: SchemaType.STRING,
      description: '2-8 emojis for the main visual elements that define this artwork. Order by importance. One emoji per concept. Avoid color-only emojis unless depicting actual colored objects.',
      minLength: 2,
      maxLength: 32  // Emojis can be multi-byte, allowing for up to 8
    }
  },
  required: ['altText', 'longDescription', 'emojiSummary'] as string[],
};

export async function generateVisualDescription(
  imagePath: string
): Promise<DescriptionResult> {
  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: descriptionSchema as any,
        temperature: 0.1, // Low temperature for consistency
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 4096, // Increased to prevent truncation
      },
    });

    // Read image file
    const imageData = await fs.readFile(imagePath);
    const base64Image = imageData.toString('base64');

    // Generate content
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      },
      COOPER_HEWITT_PROMPT,
    ]);

    const response = result.response;
    const text = response.text();

    // Log the raw response for debugging
    console.log('Raw response length:', text.length);
    
    // Parse the JSON response
    let descriptions: VisualDescription;
    try {
      descriptions = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse JSON response:');
      console.error('First 500 chars:', text.substring(0, 500));
      console.error('Last 100 chars:', text.substring(text.length - 100));
      console.error('Parse error:', parseError);
      throw new Error('Invalid JSON response from Gemini');
    }

    // Validate the response
    if (!descriptions.altText || !descriptions.longDescription || !descriptions.emojiSummary) {
      throw new Error('Missing required fields in response');
    }

    // Validate alt text word count (should be exactly 15 words)
    const wordCount = descriptions.altText.split(/\s+/).length;
    if (wordCount < 10 || wordCount > 20) {
      console.warn(`Alt text has ${wordCount} words, expected ~15`);
    }

    return {
      descriptions,
      model: 'gemini-2.5-flash',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Gemini API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate description: ${errorMessage}`);
  }
}


// Quality control function
export function validatePureDescription(description: string): { isValid: boolean; violations: string[] } {
  // Terms that suggest metadata leaked in
  const metadataIndicators = [
    /\b\d{4}s?\b/i, // Years (1960, 1960s)
    /\b(century|period|dynasty|era)\b/i, // Time periods
    /\b(american|european|african|asian|chinese|japanese|indian)\b/i, // Geographic/cultural terms
    /\b(artist|painter|sculptor|creator|maker)\b/i, // Creator references
    /\bcreated by\b/i,
    /\bmade in\b/i,
    /\bfrom the\b/i,
    /\b(museum|collection|gallery)\b/i, // Institution references
    /\b(oil painting|watercolor|bronze sculpture|marble)\b/i, // Assumed materials (unless clearly visible)
  ];

  const violations: string[] = [];
  
  for (const pattern of metadataIndicators) {
    const match = description.match(pattern);
    if (match) {
      violations.push(match[0]);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}