import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { BaseParser, ParsedArtwork } from './types';
import { ArtworkMetadata, ArtworkImage } from '@/app/types';

interface MoMACSVRow {
  Title: string;
  Artist: string;
  ConstituentID: string;
  ArtistBio: string;
  Nationality: string;
  BeginDate: string;
  EndDate: string;
  Gender: string;
  Date: string;
  Medium: string;
  Dimensions: string;
  CreditLine: string;
  AccessionNumber: string;
  Classification: string;
  Department: string;
  DateAcquired: string;
  Cataloged: string;
  ObjectID: string;
  URL: string;
  ImageURL: string;
  OnView: string;
  'Height (cm)': string;
  'Width (cm)': string;
  'Depth (cm)': string;
  'Diameter (cm)': string;
  'Weight (kg)': string;
  'Duration (sec.)': string;
}

export class MoMAParser extends BaseParser {
  getCollectionId(): string {
    return 'moma';
  }
  
  getCollectionName(): string {
    return 'Museum of Modern Art';
  }
  
  async parseFile(filePath: string): Promise<ParsedArtwork[]> {
    const artworks: ParsedArtwork[] = [];
    
    const parser = createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        cast: false
      }));
    
    for await (const record of parser) {
      const row = record as MoMACSVRow;
      
      // Skip if no image
      if (!row.ImageURL || row.ImageURL.trim() === '') {
        continue;
      }
      
      // Parse dates
      const { begin: dateBegin, end: dateEnd } = this.extractYear(row.Date);
      
      // Parse artist dates (negative numbers indicate birth years)
      const artistBegin = row.BeginDate ? Math.abs(parseInt(row.BeginDate)) : undefined;
      const artistEnd = row.EndDate ? Math.abs(parseInt(row.EndDate)) : undefined;
      
      // Parse physical dimensions
      const width = row['Width (cm)'] ? parseFloat(row['Width (cm)']) : undefined;
      const height = row['Height (cm)'] ? parseFloat(row['Height (cm)']) : undefined;
      const depth = row['Depth (cm)'] ? parseFloat(row['Depth (cm)']) : undefined;
      const diameter = row['Diameter (cm)'] ? parseFloat(row['Diameter (cm)']) : undefined;
      const weight = row['Weight (kg)'] ? parseFloat(row['Weight (kg)']) : undefined;
      
      // Create metadata
      const metadata: ArtworkMetadata = {
        // Core fields
        id: `moma_${row.ObjectID}`,
        title: row.Title || 'Untitled',
        artist: row.Artist || 'Unknown',
        date: row.Date || '',
        medium: row.Medium || '',
        dimensions: this.cleanDimensions(row.Dimensions || ''),
        creditLine: row.CreditLine || '',
        
        // Collection info
        collection: 'moma',
        collectionId: row.ObjectID,
        sourceUrl: row.URL || `https://www.moma.org/collection/works/${row.ObjectID}`,
        
        // Additional fields
        department: row.Department || '',
        classification: row.Classification || '',
        
        // Artist info
        artistBio: row.ArtistBio || '',
        artistNationality: row.Nationality || '',
        artistBeginDate: artistBegin,
        artistEndDate: artistEnd,
        artistGender: row.Gender || '',
        
        // Dates
        dateBegin,
        dateEnd,
        
        // Physical properties
        width,
        height,
        depth,
        diameter,
        weight,
        
        // Status flags
        isHighlight: false, // MoMA doesn't provide this
        isPublicDomain: true, // Assuming images are available = public domain
        onView: row.OnView === 'Y' || row.OnView === '1' || row.OnView === 'true',
        
        // Additional MoMA-specific data
        additionalData: {
          accessionNumber: row.AccessionNumber,
          cataloged: row.Cataloged === 'Y',
          dateAcquired: row.DateAcquired,
          constituentId: row.ConstituentID
        }
      };
      
      // Create image object
      const image: ArtworkImage = {
        url: row.ImageURL,
        // MoMA image URLs already include size parameters
        thumbnailUrl: row.ImageURL.replace('1024x1024', '400x400'),
      };
      
      artworks.push({
        metadata,
        image
      });
    }
    
    return artworks;
  }
}