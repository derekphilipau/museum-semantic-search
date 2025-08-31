#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from 'csv-parse';
import { createReadStream } from 'fs';

interface MetCSVRow {
  'Object ID': string;
  'Is Highlight': string;
  'Is Public Domain': string;
  'Object Number': string;
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

interface RawArtwork {
  object_id: number;
  title: string;
  artist: string;
  artist_bio: string;
  department: string;
  culture: string;
  period: string;
  object_date: string;
  object_begin_date: number;
  object_end_date: number;
  medium: string;
  dimensions: string;
  credit_line: string;
  tags?: string[];
  filename?: string;
  filepath?: string;
  is_public_domain: boolean;
  is_highlight: boolean;
}

// Departments we want to include - reduced dataset focusing on key collections
const ALLOWED_DEPARTMENTS = [
  'European Paintings',
  'Asian Art',
  'Islamic Art'
];

async function getAvailableImages(): Promise<Map<number, string>> {
  const imageMap = new Map<number, string>();
  
  // Check for images in HuggingFace directory
  const imageDirs = [
    path.join(process.cwd(), 'data', 'images', 'huggingface'), // HuggingFace dataset
  ];
  
  for (const imageDir of imageDirs) {
    try {
      const files = await fs.readdir(imageDir);
      for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
          // Extract object ID from filename
          // Handle both old format (435570_Artist_Name.jpg) and new format (435570.jpg)
          const objectId = parseInt(file.split(/[_.]/, 2)[0]);
          if (!isNaN(objectId) && !imageMap.has(objectId)) {
            imageMap.set(objectId, path.join(imageDir, file));
          }
        }
      }
    } catch (error) {
      // Directory might not exist, that's okay
    }
  }
  
  return imageMap;
}

function parseCSVRow(row: MetCSVRow): Omit<RawArtwork, 'filename' | 'filepath'> {
  const objectId = parseInt(row['Object ID']);
  
  // Parse tags from pipe-separated string
  const tags = row['Tags'] ? 
    row['Tags'].split('|').map(tag => tag.trim()).filter(Boolean) : 
    [];
  
  // Parse dates
  const objectBeginDate = parseInt(row['Object Begin Date']) || 0;
  const objectEndDate = parseInt(row['Object End Date']) || 0;
  
  return {
    object_id: objectId,
    title: row['Title'] || 'Untitled',
    artist: row['Artist Display Name'] || 'Unknown',
    artist_bio: row['Artist Display Bio'] || '',
    department: row['Department'] || '',
    culture: row['Culture'] || '',
    period: row['Period'] || '',
    object_date: row['Object Date'] || '',
    object_begin_date: objectBeginDate,
    object_end_date: objectEndDate,
    medium: row['Medium'] || '',
    dimensions: row['Dimensions'] || '',
    credit_line: row['Credit Line'] || '',
    tags: tags,
    is_public_domain: row['Is Public Domain'] === 'True',
    is_highlight: row['Is Highlight'] === 'True'
  };
}

async function parseMetObjectsCSV(): Promise<RawArtwork[]> {
  const csvPath = path.join(process.cwd(), 'data', 'MetObjects.csv');
  const artworks: RawArtwork[] = [];
  
  // Get available images
  console.log('Loading available images...');
  const imageMap = await getAvailableImages();
  console.log(`Found ${imageMap.size} image files`);
  
  // Parse CSV
  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relaxColumnCount: true,
      skipRecordsWithError: true
    });
    
    let totalRows = 0;
    let publicDomainRows = 0;
    let matchedWithImages = 0;
    
    parser.on('readable', function() {
      let record: MetCSVRow;
      while ((record = parser.read()) !== null) {
        totalRows++;
        
        const artwork = parseCSVRow(record);
        
        // Only include public domain artworks from allowed departments
        if (artwork.is_public_domain && ALLOWED_DEPARTMENTS.includes(artwork.department)) {
          publicDomainRows++;
          
          // Check if we have an image for this artwork
          const imagePath = imageMap.get(artwork.object_id);
          if (imagePath) {
            const filename = path.basename(imagePath);
            artworks.push({
              ...artwork,
              filename: filename,
              filepath: imagePath
            });
            matchedWithImages++;
          }
        }
        
        // Progress update every 10000 rows
        if (totalRows % 10000 === 0) {
          console.log(`Processed ${totalRows} rows...`);
        }
      }
    });
    
    parser.on('error', function(err) {
      console.error('CSV parsing error:', err);
      reject(err);
    });
    
    parser.on('end', function() {
      console.log(`\nCSV Parsing Complete:`);
      console.log(`- Total rows: ${totalRows}`);
      console.log(`- Public domain artworks in selected departments: ${publicDomainRows}`);
      console.log(`- Matched with images: ${matchedWithImages}`);
      resolve(artworks);
    });
    
    // Start parsing
    createReadStream(csvPath).pipe(parser);
  });
}

// Removed saveMetadata - no longer saving intermediate JSON file

// This script is now used as a module by index-artworks.ts
// No longer needed as a standalone script

// Module exports only - not meant to be run directly

export { parseMetObjectsCSV };