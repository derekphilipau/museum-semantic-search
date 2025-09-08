import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { BaseParser, ParsedArtwork } from './types';
import { ArtworkImage, Artist } from '../../../app/types';

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
  // Added by our fetch script
  'primaryImage': string;
  'primaryImageSmall': string;
  'hasImage': string;
  'fetchedAt': string;
}

export class MetParser extends BaseParser {
  getCollectionId(): string {
    return 'met';
  }
  
  getCollectionName(): string {
    return 'The Metropolitan Museum of Art';
  }
  
  private parseArtists(row: MetCSVRow): Artist[] {
    const artists: Artist[] = [];
    
    // Split all pipe-delimited fields
    const constituentIds = row['Constituent ID']?.split('|') || [];
    const roles = row['Artist Role']?.split('|') || [];
    const prefixes = row['Artist Prefix']?.split('|') || [];
    const names = row['Artist Display Name']?.split('|') || [];
    const bios = row['Artist Display Bio']?.split('|') || [];
    const suffixes = row['Artist Suffix']?.split('|') || [];
    const alphaSorts = row['Artist Alpha Sort']?.split('|') || [];
    const nationalities = row['Artist Nationality']?.split('|') || [];
    const beginDates = row['Artist Begin Date']?.split('|') || [];
    const endDates = row['Artist End Date']?.split('|') || [];
    const genders = row['Artist Gender']?.split('|') || [];
    const ulanUrls = row['Artist ULAN URL']?.split('|') || [];
    const wikidataUrls = row['Artist Wikidata URL']?.split('|') || [];
    
    // Create artist objects (use names length as the count)
    for (let i = 0; i < names.length; i++) {
      const name = names[i]?.trim();
      if (!name || name === '') continue;
      
      const artist: Artist = {
        displayName: name,
        constituentId: constituentIds[i]?.trim() || undefined,
        role: roles[i]?.trim() || 'Artist',
        prefix: prefixes[i]?.trim() || undefined,
        displayBio: bios[i]?.trim() || undefined,
        suffix: suffixes[i]?.trim() || undefined,
        alphaSort: alphaSorts[i]?.trim() || undefined,
        nationality: nationalities[i]?.trim() || undefined,
        beginDate: beginDates[i]?.trim() ? parseInt(beginDates[i].trim()) : undefined,
        endDate: endDates[i]?.trim() ? parseInt(endDates[i].trim()) : undefined,
        gender: genders[i]?.trim() || undefined,
        ulanUrl: ulanUrls[i]?.trim() || undefined,
        wikidataUrl: wikidataUrls[i]?.trim() || undefined
      };
      
      artists.push(artist);
    }
    
    return artists;
  }
  
  async parseFile(filePath: string, limit?: number): Promise<ParsedArtwork[]> {
    const artworks: ParsedArtwork[] = [];
    
    console.log(`Parsing Met paintings from ${filePath}`);
    
    const parser = createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        cast: false,
        bom: true,
        quote: '"',
        escape: '"',
        relax_quotes: true
      }));
    
    let count = 0;
    for await (const record of parser) {
      const row = record as MetCSVRow;
      
      // The file should already contain only paintings with images
      // But we'll double-check
      if (!row.hasImage || row.hasImage !== 'True' || !row.primaryImage) {
        continue;
      }
      
      // Parse dates
      const { begin: dateBegin, end: dateEnd } = this.extractYear(row['Object Date']);
      
      // Parse all artists
      const artists = this.parseArtists(row);
      
      // Get primary artist info for backwards compatibility
      const primaryArtist = artists[0];
      const artistBegin = primaryArtist?.beginDate;
      const artistEnd = primaryArtist?.endDate;
      
      // Create artwork object
      const artwork: ParsedArtwork = {
        // Core fields
        id: `met_${row['Object ID']}`,
        title: row.Title || 'Untitled',
        artist: row['Artist Display Name'] || 'Unknown',
        artists: artists.length > 0 ? artists : undefined,
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
        objectName: row['Object Name'] || '',
        culture: row.Culture || '',
        period: row.Period || '',
        dynasty: row.Dynasty || '',
        
        // Geographic origin
        geographyType: row['Geography Type'] || '',
        city: row.City || '',
        state: row.State || '',
        country: row.Country || '',
        region: row.Region || '',
        locale: row.Locale || '',
        excavation: row.Excavation || '',
        
        // Museum-specific
        objectNumber: row['Object Number'] || '',
        accessionYear: row.AccessionYear ? parseInt(row.AccessionYear) : undefined,
        galleryNumber: row['Gallery Number'] || '',
        portfolio: row.Portfolio || '',
        rightsAndReproduction: row['Rights and Reproduction'] || '',
        
        // DEPRECATED single artist fields (for backwards compatibility)
        artistId: primaryArtist?.constituentId || '',
        artistBio: primaryArtist?.displayBio || '',
        artistNationality: primaryArtist?.nationality || '',
        artistBeginDate: artistBegin,
        artistEndDate: artistEnd,
        artistGender: primaryArtist?.gender || '',
        
        // Dates
        dateBegin,
        dateEnd,
        
        // Status flags
        isHighlight: row['Is Highlight']?.toLowerCase() === 'true',
        isPublicDomain: row['Is Public Domain']?.toLowerCase() === 'true',
        onView: !!row['Gallery Number']?.trim(),
        
        // Tags
        tags: row.Tags ? row.Tags.split('|').map(t => t.trim()).filter(t => t) : undefined,
        
        // Additional Met-specific data
        additionalData: {
          isTimelineWork: row['Is Timeline Work']?.toLowerCase() === 'true',
          objectWikidata: row['Object Wikidata URL'],
          reign: row.Reign || '',
          county: row.County || '',
          subregion: row.Subregion || '',
          locus: row.Locus || '',
          river: row.River || '',
          tagsAAT: row['Tags AAT URL'] || '',
          tagsWikidata: row['Tags Wikidata URL'] || ''
        },
        
        // Image data directly from CSV
        image: {
          url: row.primaryImageSmall || row.primaryImage,
          thumbnailUrl: row.primaryImageSmall || row.primaryImage
        }
      };
      
      artworks.push(artwork);
      count++;
      
      // Show progress
      if (count % 100 === 0) {
        console.log(`  Processed ${count} artworks...`);
      }
      
      // Apply limit if specified
      if (limit && count >= limit) {
        parser.destroy();
        break;
      }
    }
    
    console.log(`Successfully loaded ${artworks.length} paintings with images`);
    return artworks;
  }
}