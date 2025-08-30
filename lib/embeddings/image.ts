import { ModelKey } from './types';
import * as fs from 'fs/promises';
import { GoogleAuth } from 'google-auth-library';

// Image embedding functions for each provider

export async function generateJinaImageEmbedding(
  imagePath: string,
  modelId: string,
  interleaveText?: string
): Promise<number[]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error('JINA_API_KEY not found');
  
  // Read image and convert to base64
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  
  // For Jina v4, use interleaved input format
  let input;
  if (modelId === 'jina-embeddings-v4' && interleaveText) {
    // v4 supports combined text+image input
    input = [{
      text: interleaveText,
      image: base64Image
    }];
  } else {
    // For clip-v2 or v4 without text, use image-only input
    input = [{
      image: base64Image
    }];
  }
  
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: input,
      encoding_type: 'float',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina image embedding failed: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function generateVoyageImageEmbedding(
  imagePath: string,
  modelId: string,
  interleaveText?: string
): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not found');
  
  // Read image and convert to base64
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  
  // Build content array based on whether we have text
  const content = interleaveText ? [
    {
      type: 'text',
      text: interleaveText
    },
    {
      type: 'image_base64',
      image_base64: base64Image
    }
  ] : [
    {
      type: 'image_base64',
      image_base64: base64Image
    }
  ];
  
  const response = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      inputs: [{
        content: content
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage image embedding failed: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function generateCohereImageEmbedding(
  imagePath: string,
  modelId: string,
  interleaveText?: string
): Promise<number[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not found');
  
  // Read image and convert to base64 data URI
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  
  const response = await fetch('https://api.cohere.com/v2/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      ...(interleaveText ? {
        texts: [interleaveText],
        images: [base64Image],
        input_type: 'search_document',
      } : {
        images: [base64Image],
        input_type: 'image',
      }),
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cohere image embedding failed: ${error}`);
  }

  const data = await response.json();
  return data.embeddings.float[0];
}

// Google Auth client singleton
let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Google service account credentials not configured');
    }

    authClient = new GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      projectId,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  
  return authClient;
}

export async function generateGoogleImageEmbedding(
  imagePath: string,
  interleaveText?: string
): Promise<number[]> {
  try {
    const auth = getAuthClient();
    const accessToken = await auth.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to get Google access token');
    }

    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
    
    // Read image and convert to base64
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Use multimodal embedding model
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/multimodalembedding@001:predict`;

    const instances = interleaveText ? [{
      text: interleaveText,
      image: {
        bytesBase64Encoded: base64Image
      }
    }] : [{
      image: {
        bytesBase64Encoded: base64Image
      }
    }];

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Vertex AI image embedding failed: ${error}`);
    }

    const data = await response.json();
    
    // Handle different response formats
    if (data.predictions && data.predictions[0]) {
      if (data.predictions[0].imageEmbedding) {
        return data.predictions[0].imageEmbedding;
      } else if (data.predictions[0].embeddings) {
        return data.predictions[0].embeddings;
      } else if (data.predictions[0].embedding) {
        return data.predictions[0].embedding;
      }
    }
    
    throw new Error('Unexpected response format from Google Vertex AI');
  } catch (error) {
    console.error('Google Vertex AI image error:', error);
    throw error;
  }
}

// Main function to generate image embeddings
export async function generateImageEmbedding(
  imagePath: string,
  model: ModelKey,
  interleaveText?: string
): Promise<{ embedding: number[]; model: string; dimension: number }> {
  let embedding: number[];
  
  switch (model) {
    case 'jina_embeddings_v4':
      embedding = await generateJinaImageEmbedding(imagePath, 'jina-embeddings-v4', interleaveText);
      break;
      
    case 'google_vertex_multimodal':
      embedding = await generateGoogleImageEmbedding(imagePath, interleaveText);
      break;
      
    default:
      throw new Error(`Unsupported model for image embeddings: ${model}`);
  }
  
  return {
    embedding,
    model,
    dimension: embedding.length,
  };
}