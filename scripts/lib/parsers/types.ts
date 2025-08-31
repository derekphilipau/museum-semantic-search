import { ArtworkMetadata, ArtworkImage } from '@/app/types';

// Generic parser interface that all collection parsers must implement
export interface CollectionParser {
  // Parse a CSV/JSON file and return normalized artwork data
  parseFile(filePath: string): Promise<ParsedArtwork[]>;
  
  // Get collection identifier
  getCollectionId(): string;
  
  // Get collection display name
  getCollectionName(): string;
}

// Intermediate format before indexing
export interface ParsedArtwork {
  metadata: ArtworkMetadata;
  image: ArtworkImage | string;
}

// Base parser class with common functionality
export abstract class BaseParser implements CollectionParser {
  abstract parseFile(filePath: string): Promise<ParsedArtwork[]>;
  abstract getCollectionId(): string;
  abstract getCollectionName(): string;
  
  // Helper to extract year from various date formats
  protected extractYear(dateStr: string): { begin: number | undefined, end: number | undefined } {
    if (!dateStr) return { begin: undefined, end: undefined };
    
    // Handle range like "1950-1960" or "1950–1960"
    const rangeMatch = dateStr.match(/(\d{4})[–-](\d{4})/);
    if (rangeMatch) {
      return {
        begin: parseInt(rangeMatch[1]),
        end: parseInt(rangeMatch[2])
      };
    }
    
    // Handle single year
    const yearMatch = dateStr.match(/\d{4}/);
    if (yearMatch) {
      const year = parseInt(yearMatch[0]);
      return { begin: year, end: year };
    }
    
    // Handle "ca." dates
    const circaMatch = dateStr.match(/ca\.\s*(\d{4})/);
    if (circaMatch) {
      const year = parseInt(circaMatch[1]);
      return { begin: year - 5, end: year + 5 }; // ±5 years for circa
    }
    
    return { begin: undefined, end: undefined };
  }
  
  // Helper to clean dimension strings
  protected cleanDimensions(dimensions: string): string {
    return dimensions
      .replace(/\s+/g, ' ')
      .replace(/["″]/g, '"')
      .replace(/['′]/g, "'")
      .trim();
  }
  
  // Helper to parse physical dimensions from various formats
  protected parsePhysicalDimensions(dimStr: string): {
    width?: number;
    height?: number;
    depth?: number;
    diameter?: number;
  } {
    const dims: any = {};
    
    // Try to extract height x width x depth pattern
    const hwdMatch = dimStr.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:[x×]\s*(\d+(?:\.\d+)?))?/);
    if (hwdMatch) {
      dims.height = parseFloat(hwdMatch[1]);
      dims.width = parseFloat(hwdMatch[2]);
      if (hwdMatch[3]) dims.depth = parseFloat(hwdMatch[3]);
    }
    
    // Try to extract diameter
    const diamMatch = dimStr.match(/diameter[:\s]+(\d+(?:\.\d+)?)/i);
    if (diamMatch) {
      dims.diameter = parseFloat(diamMatch[1]);
    }
    
    return dims;
  }
}