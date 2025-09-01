import { GoogleAuth } from 'google-auth-library';
import { EmbeddingResponse } from './types';

// Initialize Google Auth client
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

export async function generateGoogleTextEmbedding(
  text: string,
  modelId: string = 'text-embedding-005'
): Promise<EmbeddingResponse> {
  try {
    const auth = getAuthClient();
    const accessToken = await auth.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to get Google access token');
    }

    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
    
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{
          content: text,
        }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Vertex AI error: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    
    if (!data.predictions || !data.predictions[0] || !data.predictions[0].embeddings || !data.predictions[0].embeddings.values) {
      throw new Error('Unexpected Google Vertex AI response format');
    }

    const embedding = data.predictions[0].embeddings.values;

    return {
      embedding,
      model: 'google_gemini_text',
      dimension: embedding.length,
    };
  } catch (error) {
    console.error('Google Vertex AI text embedding error:', error);
    throw error;
  }
}

export async function generateGoogleEmbedding(
  text: string,
  modelId: string = 'multimodalembedding@001'
): Promise<EmbeddingResponse> {
  try {
    const auth = getAuthClient();
    const accessToken = await auth.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Failed to get Google access token');
    }

    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
    
    // Use multimodal embedding model for text
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{
          text: text,
        }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Vertex AI error: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    
    // Handle multimodal response format
    let embedding: number[];
    if (data.predictions && data.predictions[0]) {
      if (data.predictions[0].textEmbedding) {
        embedding = data.predictions[0].textEmbedding;
      } else if (data.predictions[0].embeddings) {
        embedding = data.predictions[0].embeddings.values || data.predictions[0].embeddings;
      } else {
        throw new Error('Unexpected Google Vertex AI response format');
      }
    } else {
      throw new Error('No predictions in Google Vertex AI response');
    }

    return {
      embedding,
      model: 'google_vertex_multimodal',
      dimension: embedding.length,
    };
  } catch (error) {
    console.error('Google Vertex AI error:', error);
    throw error;
  }
}