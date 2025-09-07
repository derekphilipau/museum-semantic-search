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
      // Check if response is empty
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }
      
      descriptions = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse JSON response:');
      console.error('Response length:', text.length);
      console.error('First 500 chars:', text.substring(0, 500));
      console.error('Last 100 chars:', text.substring(text.length - 100));
      console.error('Parse error:', parseError);
      
      if (text.length === 0) {
        throw new Error('Empty response from Gemini - API may be overloaded');
      } else if (text.includes('```json')) {
        throw new Error('Response contains markdown code blocks instead of pure JSON');
      } else {
        throw new Error('Invalid JSON response from Gemini');
      }
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


// Cooper Hewitt v0.2 prompt for editing existing descriptions
const COOPER_HEWITT_EDIT_PROMPT = `You are an art historian and accessibility expert specializing in editing museum artwork descriptions to meet the highest standards of accessibility and objectivity.

Review and edit the provided artwork descriptions to ensure they precisely adhere to the following guidelines:

1. ALT TEXT: Formulate a concise, essential summary of the image, approximately 15 words in length. Present it as a sentence fragment (or a complete sentence if necessary) without a period at the end, focusing on conveying the image's most critical visual content.

2. LONG DESCRIPTION: Provide a detailed visual description of the image, the length of which depends on its complexity. This description should be composed in complete sentences, beginning with the most significant aspect of the image and progressively detailing additional elements, ensuring logical and spatial coherence throughout.

3. EMOJI SUMMARY: Select 2-8 emojis that represent the main visual elements in order of importance. Use ONE emoji per subject or concept. Focus only on content visible in the artwork. Never include display emojis like 🏛️⚱🎨🖼️. Avoid color-only emojis unless color is the primary subject. Choose specific over generic emojis. Consider the primary cultural association of each emoji - ensure it accurately represents what viewers see rather than potentially misleading them. When no emoji clearly represents a detail, it's better to omit it than to use one that might be misinterpreted.

General Requirements:
- Avoid Redundancy: Do not repeat artist name, date, or other details that are already in the title or metadata.
- Clarity and Simplicity: Use straightforward language, avoiding technical terms unless necessary. If technical terms are used, they should be clearly explained.
- Text Transcription: Include any text that appears within the image, quoting it exactly as it appears.

Core Aspects:
- Subject: Prioritize the most prominent or noticeable element of the image.
- Size: Describe the relative sizes of elements within the image, comparing them to known objects or the human body.
- Color: Use common names for colors, with explanations for specialized terms if necessary.
- Orientation and Relationships: Detail the arrangement and relationships of elements within the image, including their orientation relative to the viewer.
- Medium and Style: Only describe the material or artistic style if it's clearly visible in the image itself.
- People Description: Include details on physical appearance without assumptions about age, gender, ethnicity. Use neutral terms and describe only what is visible.

CRITICAL: Strictly avoid:
- Subjective interpretations, symbolic meanings, or attributing intent to the artwork
- Conjectures about the meaning of the artwork
- Guessing the feelings of people or beings represented
- Assumptions that cannot be strictly inferred from the artwork image itself
- Value judgements about the work (e.g., "a fine example")
- Guessing how an artwork may have been perceived by a viewer
- Mentioning artist names or dates unless they are literally visible written in the image

IMPORTANT: When visual elements are ambiguous or unclear, you may use qualified language such as "possibly," "appears to be," or "likely" to acknowledge uncertainty while maintaining accuracy. This is preferable to making definitive statements about unclear visual elements.`;

// JSON schema for edited descriptions
const editDescriptionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    altText: {
      type: SchemaType.STRING,
      description: 'Edited alt text: ~15 words, no metadata, objective visual summary only'
    },
    longDescription: {
      type: SchemaType.STRING,
      description: 'Edited long description: detailed visual description without interpretation'
    },
    emojiSummary: {
      type: SchemaType.STRING,
      description: 'Edited emoji summary: 2-8 emojis for main visual elements, one per concept',
      minLength: 2,
      maxLength: 32
    },
    changesMade: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING
      },
      description: 'List of specific changes made to improve the descriptions'
    }
  },
  required: ['altText', 'longDescription', 'emojiSummary', 'changesMade'] as string[],
};

export interface EditedVisualDescription extends VisualDescription {
  changesMade: string[];
}

export interface EditDescriptionResult {
  descriptions: EditedVisualDescription;
  model: string;
  timestamp: string;
}

export async function editVisualDescription(
  currentDescriptions: VisualDescription,
  metadata?: any
): Promise<EditDescriptionResult> {
  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: editDescriptionSchema as any,
        temperature: 0.1, // Low temperature for consistency
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 4096,
      },
    });

    const userPrompt = `Please review and edit these artwork descriptions:

ALT TEXT: ${currentDescriptions.altText}

LONG DESCRIPTION: ${currentDescriptions.longDescription}

EMOJI SUMMARY: ${currentDescriptions.emojiSummary}

Edit these descriptions to ensure they meet all accessibility guidelines. Focus especially on:
- Removing any metadata references (artist names, dates, cultural assumptions)
- Ensuring alt text is approximately 15 words
- Fixing grammatical issues like "from the"
- Maintaining purely objective visual descriptions
- Ensuring emojis represent only visible content`;

    // Debug: Log what we're sending
    console.log('    Sending to Gemini:');
    console.log('    Prompt length:', COOPER_HEWITT_EDIT_PROMPT.length + userPrompt.length, 'chars');
    console.log('    Alt text:', currentDescriptions.altText?.substring(0, 50) || 'MISSING');
    console.log('    Long desc:', currentDescriptions.longDescription?.substring(0, 50) || 'MISSING');
    console.log('    Emoji:', currentDescriptions.emojiSummary || 'MISSING');

    // Generate edited content
    const result = await model.generateContent([
      COOPER_HEWITT_EDIT_PROMPT,
      userPrompt,
    ]);

    const response = result.response;
    console.log('    Response status:', response.promptFeedback);
    
    const text = response.text();
    console.log('    Response text length:', text.length);
    console.log('    First 200 chars:', text.substring(0, 200));

    // Parse the JSON response
    let editedDescriptions: EditedVisualDescription;
    try {
      // Check if response is empty
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }
      
      editedDescriptions = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse JSON response:');
      console.error('Response length:', text.length);
      console.error('First 500 chars:', text.substring(0, 500));
      console.error('Parse error:', parseError);
      
      if (text.length === 0) {
        throw new Error('Empty response from Gemini - API may be overloaded');
      } else if (text.includes('```json')) {
        throw new Error('Response contains markdown code blocks instead of pure JSON');
      } else {
        throw new Error('Invalid JSON response from Gemini');
      }
    }

    // Validate the response
    if (!editedDescriptions.altText || !editedDescriptions.longDescription || 
        !editedDescriptions.emojiSummary || !editedDescriptions.changesMade) {
      throw new Error('Missing required fields in response');
    }

    return {
      descriptions: editedDescriptions,
      model: 'gemini-2.5-flash',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Gemini API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to edit description: ${errorMessage}`);
  }
}