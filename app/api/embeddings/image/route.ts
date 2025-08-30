import { NextRequest, NextResponse } from 'next/server';
import { generateImageEmbedding } from '@/lib/embeddings/image';
import { ModelKey, EMBEDDING_MODELS } from '@/lib/embeddings/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Type guard for model validation
function isValidModel(model: any): model is ModelKey {
  return model in EMBEDDING_MODELS;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const model = formData.get('model') as string;
    const interleaveText = formData.get('interleaveText') as string | null;
    
    // Validate required fields
    if (!image || !model) {
      return NextResponse.json(
        { error: 'Missing required fields: image and model' },
        { status: 400 }
      );
    }

    // Validate model
    if (!isValidModel(model)) {
      return NextResponse.json(
        { error: `Invalid model. Must be one of: ${Object.keys(EMBEDDING_MODELS).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(image.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (image.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Sanitize filename and create secure temp path
    const fileExtension = path.extname(image.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Generate secure random filename
    const tempDir = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const secureFilename = `upload-${crypto.randomUUID()}${fileExtension}`;
    const tempPath = path.join(tempDir, secureFilename);
    
    // Ensure we're not writing outside temp directory (path traversal protection)
    const resolvedPath = path.resolve(tempPath);
    const resolvedTempDir = path.resolve(tempDir);
    if (!resolvedPath.startsWith(resolvedTempDir)) {
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 400 }
      );
    }
    
    const arrayBuffer = await image.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    await fs.writeFile(tempPath, buffer);
    
    try {
      // Generate embedding
      const result = await generateImageEmbedding(
        tempPath,
        model,
        interleaveText || undefined
      );
      
      // Clean up temp file
      await fs.unlink(tempPath);
      
      return NextResponse.json(result);
    } catch (error) {
      // Clean up temp file on error
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error('Image embedding error:', error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to generate image embedding' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';