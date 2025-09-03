import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { BaseParser, ParsedArtwork } from './types';
import { ArtworkMetadata, ArtworkImage } from '../../../app/types';
import { loadMetImageCache, MetImageCache } from '../met-api-cache';

interface MetCSVRow {
  'Object Number': string;
  'Is Highlight': string;
  'Is Timeline Work': string;
  'Is Public Domain': string;
  'Object ID': string;
  'Gallery Number': string;
  'Department': string;
  'AccessionYear': string;
  'Object Name': string;
  'Title': string;
  'Culture': string;
  'Period': string;
  'Dynasty': string;
  'Reign': string;
  'Portfolio': string;
  'Constituent ID': string;
  'Artist Role': string;
  'Artist Prefix': string;
  'Artist Display Name': string;
  'Artist Display Bio': string;
  'Artist Suffix': string;
  'Artist Alpha Sort': string;
  'Artist Nationality': string;
  'Artist Begin Date': string;
  'Artist End Date': string;
  'Artist Gender': string;
  'Artist ULAN URL': string;
  'Artist Wikidata URL': string;
  'Object Date': string;
  'Object Begin Date': string;
  'Object End Date': string;
  'Medium': string;
  'Dimensions': string;
  'Credit Line': string;
  'Geography Type': string;
  'City': string;
  'State': string;
  'County': string;
  'Country': string;
  'Region': string;
  'Subregion': string;
  'Locale': string;
  'Locus': string;
  'Excavation': string;
  'River': string;
  'Classification': string;
  'Rights and Reproduction': string;
  'Link Resource': string;
  'Object Wikidata URL': string;
  'Metadata Date': string;
  'Repository': string;
  'Tags': string;
  'Tags AAT URL': string;
  'Tags Wikidata URL': string;
}

interface MetAPIResponse {
  objectID: number;
  primaryImage: string;
  primaryImageSmall: string;
  additionalImages: string[];
}

export class MetParser extends BaseParser {
  private imageCache: MetImageCache | null = null;
  
  getCollectionId(): string {
    return 'met';
  }
  
  getCollectionName(): string {
    return 'The Metropolitan Museum of Art';
  }
  
  async loadImageCache(): Promise<void> {
    if (!this.imageCache) {
      this.imageCache = await loadMetImageCache();
      const withImages = Object.values(this.imageCache).filter(item => item.hasImage).length;
      console.log(`Loaded Met image cache: ${Object.keys(this.imageCache).length} entries, ${withImages} with images`);
    }
  }
  
  async fetchImageUrl(objectId: string): Promise<{ imageUrl: string; thumbnailUrl: string } | null> {
    // Ensure cache is loaded
    await this.loadImageCache();
    
    // Check cache first
    const cached = this.imageCache?.[objectId];
    if (cached) {
      if (cached.hasImage && cached.primaryImage) {
        return {
          // Use web-large for main image (not the huge original)
          imageUrl: cached.primaryImageSmall || cached.primaryImage,
          thumbnailUrl: cached.primaryImageSmall || cached.primaryImage
        };
      }
      return null;
    }
    
    // If not in cache, fetch from API (fallback)
    console.warn(`Object ${objectId} not in cache, fetching from API...`);
    
    try {
      const response = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);
      
      if (!response.ok) {
        console.warn(`Failed to fetch Met API for object ${objectId}: ${response.status}`);
        return null;
      }
      
      const data = await response.json() as MetAPIResponse;
      
      if (data.primaryImage) {
        return {
          // Use web-large for main image (not the huge original)
          imageUrl: data.primaryImageSmall || data.primaryImage,
          thumbnailUrl: data.primaryImageSmall || data.primaryImage
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Error fetching Met API for object ${objectId}:`, error);
      return null;
    }
  }
  
  async parseFile(filePath: string, limit?: number): Promise<ParsedArtwork[]> {
    const artworks: ParsedArtwork[] = [];
    const rows: MetCSVRow[] = [];
    
    // First, collect painting rows (up to limit if specified)
    const parser = createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        cast: false,
        bom: true // Handle BOM in Met CSV
      }));
    
    for await (const record of parser) {
      const row = record as MetCSVRow;
      
      // Filter artworks by criteria:
      if (row.Classification?.toLowerCase() === 'paintings' &&  // ONLY get Paintings
          row['Is Public Domain']?.toLowerCase() === 'true' &&  // ONLY Public Domain
          row['Link Resource']?.trim()) {  // MUST have a link
        rows.push(row);
        
        // Stop collecting if we've reached the limit
        if (limit && rows.length >= limit) {
          parser.destroy(); // Stop reading the CSV
          break;
        }
      }
    }
    
    console.log(`Found ${rows.length} artworks to process`);
    
    // Process each row and fetch image URLs
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Show progress every 100 items
      if (i > 0 && i % 100 === 0) {
        console.log(`Processing artwork ${i}/${rows.length}...`);
      }
      
      // Fetch image URL from Met API
      const imageUrls = await this.fetchImageUrl(row['Object ID']);
      
      if (!imageUrls || !imageUrls.imageUrl) {
        console.log(`Skipping ${row['Object ID']} - no image URL from API`);
        continue;
      }
      
      // Parse dates
      const { begin: dateBegin, end: dateEnd } = this.extractYear(row['Object Date']);
      
      // Parse artist dates
      const artistBegin = row['Artist Begin Date'] ? parseInt(row['Artist Begin Date']) : undefined;
      const artistEnd = row['Artist End Date'] ? parseInt(row['Artist End Date']) : undefined;
      
      // Create metadata
      const metadata: ArtworkMetadata = {
        // Core fields
        id: `met_${row['Object ID']}`,
        title: row.Title || 'Untitled',
        artist: row['Artist Display Name'] || 'Unknown',
        date: row['Object Date'] || '',
        medium: row.Medium || '',
        dimensions: this.cleanDimensions(row.Dimensions || ''),
        creditLine: row['Credit Line'] || '',
        
        // Collection info
        collection: 'met',
        collectionId: row['Object ID'],
        sourceUrl: row['Link Resource'] || `https://www.metmuseum.org/art/collection/search/${row['Object ID']}`,
        
        // Additional fields
        department: row.Department || '',
        classification: row.Classification || '',
        culture: row.Culture || '',
        period: row.Period || '',
        dynasty: row.Dynasty || '',
        
        // Artist info
        artistBio: row['Artist Display Bio'] || '',
        artistNationality: row['Artist Nationality'] || '',
        artistBeginDate: artistBegin,
        artistEndDate: artistEnd,
        artistGender: row['Artist Gender'] || '',
        
        // Dates
        dateBegin,
        dateEnd,
        
        // Status flags
        isHighlight: row['Is Highlight']?.toLowerCase() === 'true',
        isPublicDomain: row['Is Public Domain']?.toLowerCase() === 'true',
        onView: !!row['Gallery Number']?.trim(), // If has gallery number, it's on view
        
        // Additional Met-specific data
        additionalData: {
          objectNumber: row['Object Number'],
          accessionYear: row.AccessionYear ? parseInt(row.AccessionYear) : null,
          objectName: row['Object Name'],
          isTimelineWork: row['Is Timeline Work']?.toLowerCase() === 'true',
          galleryNumber: row['Gallery Number'],
          artistULAN: row['Artist ULAN URL'],
          artistWikidata: row['Artist Wikidata URL'],
          objectWikidata: row['Object Wikidata URL'],
          rightsAndReproduction: row['Rights and Reproduction'],
          tags: row.Tags ? row.Tags.split('|').map(t => t.trim()).filter(t => t).join(', ') : '',
          // Fields not in base ArtworkMetadata
          reign: row.Reign || '',
          portfolio: row.Portfolio || '',
          artistRole: row['Artist Role'] || '',
          city: row.City || '',
          state: row.State || '',
          county: row.County || '',
          country: row.Country || '',
          region: row.Region || '',
          subregion: row.Subregion || '',
          locale: row.Locale || ''
        }
      };
      
      // Create image object (both use web-large, not original)
      const image: ArtworkImage = {
        url: imageUrls.imageUrl,
        thumbnailUrl: imageUrls.thumbnailUrl,
      };
      
      artworks.push({
        metadata,
        image
      });
      
      // Add a small delay to avoid hitting API rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Successfully processed ${artworks.length} paintings`);
    return artworks;
  }
}