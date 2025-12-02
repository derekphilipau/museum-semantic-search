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

const COOPER_HEWITT_PROMPT = `You are an accessibility-aware visual describer for museum artworks. For each INPUT IMAGE, return exactly this JSON—no commentary:
{"alt_text":"","long_description":""}
Return JSON keys exactly as shown: alt_text, long_description. Do not change casing or names.

Populate fields as follows.

Alt-text spec
- 10–18 words, a single sentence fragment capturing the essential subject matter (primary subject(s), key action, broad setting)
- Include a count when relevant
- If clearly visible and safely inferable, you may include the apparent medium (painting, sculpture, photograph, drawing, print)
- Use everyday words; no final period

Long-description spec
- One cohesive paragraph (about 150–220 words), present tense, plain language
- Maintain a clear, consistent spatial order

Structure
1) Overview (first 1–2 sentences): what the work shows (subject and action), orientation (vertical or horizontal), and apparent medium if evident; add a broad genre cue when helpful (portrait, landscape, still life, abstract)
2) Main pass: describe left→right (or top→bottom) and foreground→background in one consistent pass; if needed, make a second pass in the same direction for finer details
3) People: default to neutral terms (person/people, adult/child/older person). Describe pose/gesture and notable garments/objects. State gender only if clearly performed; otherwise stay neutral
4) Skin tone: include only when clearly visible and helpful for distinguishing people. Use non-ethnic descriptors (light-skinned, medium-skinned, medium-dark-skinned, dark-skinned). For groups, you may use a blanket statement (e.g., “all appear light-skinned”). Omit in grayscale or when unclear. Never use food terms
5) Other subjects: animals, objects, symbols, architecture, landscape elements—use counts for repeating things; consolidate when many are similar
6) Color words: use familiar color names only when they aid recognition (“blue sky,” “gold halo”); use specialized names only with a brief plain-language gloss if essential
7) Text in the image: transcribe all visible, legible text exactly in quotes and note placement succinctly (“banner at top,” “tablet held by central person”); preserve meaningful line breaks as \n; include signatures if legible
8) Medium and style (when visible/relevant): briefly note surface/mark-making or sculptural qualities that affect how the image reads (e.g., visible brushstrokes, silkscreen blocks, polished stone)
9) Ambiguity: state uncertainty briefly when visibility prevents precision (“likely a market,” “two or three people; partially obscured”)
10) Orientation language: when locating elements, prefer “our left / our right,” and use “faces us / turned away” rather than “the viewer”

Global rules
- Describe only what is visible; do not include symbolism, artist intent, titles, dates, or dimensions unless they appear as text in the image
- Prefer affirmative phrasing (“lips closed”) over negations (“not smiling”)
- Avoid “image of / photo of” as filler; name a format only when essential to comprehension
- Avoid jargon; if a specialized term is necessary, add a short plain-language gloss inline
- Use American English; write complete sentences in the long description

Quality check before returning
- Both fields non-empty
- alt_text is 10–18 words, a fragment, with no final period
- long_description is 150–220 words, present tense, plain language, stable spatial order, and quoted text is encoded properly`;

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
  currentDescriptions: VisualDescription
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