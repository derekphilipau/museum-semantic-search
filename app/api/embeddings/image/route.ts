import { NextRequest, NextResponse } from 'next/server';
import { generateImageEmbedding } from '@/lib/embeddings/image';
import { ModelKey } from '@/lib/embeddings/types';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const model = formData.get('model') as ModelKey;
    const interleaveText = formData.get('interleaveText') as string | null;
    
    if (!image || !model) {
      return NextResponse.json(
        { error: 'Missing required fields: image and model' },
        { status: 400 }
      );
    }
    
    // Save image temporarily
    const tempDir = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempPath = path.join(tempDir, `upload-${Date.now()}-${image.name}`);
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
  } catch (error: any) {
    console.error('Image embedding error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate image embedding' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';