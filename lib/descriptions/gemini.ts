import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs/promises';

export interface VisualDescription {
  altText: string;
  longDescription: string;
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

const COOPER_HEWITT_PROMPT = `Generate accessibility descriptions for this artwork image.

ALT TEXT: 10-20 words summarizing the essential visual content.

LONG DESCRIPTION: 100-300 words describing visual elements, colors, composition, and spatial relationships. Use neutral language without interpretations or metadata.`;

// Define the JSON schema for structured response
const descriptionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    altText: {
      type: SchemaType.STRING,
      description: '10-20 word description of the image'
    },
    longDescription: {
      type: SchemaType.STRING,
      description: 'Detailed 100-300 word description of the image'
    }
  },
  required: ['altText', 'longDescription'] as string[],
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
    if (!descriptions.altText || !descriptions.longDescription) {
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