'use client';

import { useState, useCallback } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/ui/shadcn-io/dropzone';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ImageSearchUploadProps {
  onImageSelect: (file: File | null, preview: string | null) => void;
  className?: string;
}

export default function ImageSearchUpload({ onImageSelect, className }: ImageSearchUploadProps) {
  const [files, setFiles] = useState<File[]>();
  const [preview, setPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const preprocessImage = useCallback(async (file: File): Promise<string> => {
    const MAX_WIDTH = 512;
    const MAX_HEIGHT = 512;
    const QUALITY = 0.8;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const img = new Image();
      
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        
        // Calculate new dimensions
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = (height * MAX_WIDTH) / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = (width * MAX_HEIGHT) / height;
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to base64 with compression
        const base64 = canvas.toDataURL('image/jpeg', QUALITY);
        resolve(base64);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      
      reader.readAsDataURL(file);
    });
  }, []);

  const handleDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    setFiles([file]);
    setIsProcessing(true);
    
    try {
      // Create preview
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      
      // Preprocess image
      const processedImage = await preprocessImage(file);
      
      // Notify parent component
      onImageSelect(file, processedImage);
    } catch (error) {
      console.error('Error processing image:', error);
      onImageSelect(null, null);
    } finally {
      setIsProcessing(false);
    }
  }, [preprocessImage, onImageSelect]);

  const handleClear = useCallback(() => {
    setFiles(undefined);
    setPreview(null);
    onImageSelect(null, null);
  }, [onImageSelect]);

  return (
    <div className={cn("relative", className)}>
      {preview ? (
        <div className="relative">
          <div className="relative h-24 w-full rounded-md overflow-hidden bg-muted">
            <img
              src={preview}
              alt="Search image"
              className="h-full w-full object-contain"
            />
            {isProcessing && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                <div className="text-sm text-muted-foreground">Processing...</div>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Dropzone
          accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] }}
          maxFiles={1}
          maxSize={10 * 1024 * 1024} // 10MB
          onDrop={handleDrop}
          onError={(error) => console.error('Dropzone error:', error)}
          src={files}
          className="h-24"
        >
          <DropzoneEmptyState>
            <div className="flex items-center gap-2 text-sm">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Drop image or click</span>
            </div>
          </DropzoneEmptyState>
          <DropzoneContent />
        </Dropzone>
      )}
    </div>
  );
}