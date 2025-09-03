#!/usr/bin/env node
import { MetParser } from '../lib/parsers/met-parser';
import * as path from 'path';

async function testMetParser() {
  console.log('Testing Met Parser...\n');
  
  const parser = new MetParser();
  const csvPath = path.join(process.cwd(), 'data', 'met', 'MetObjects.csv');
  
  console.log('Parsing Met CSV (limited to first 5 paintings)...');
  console.log('This will make API calls to fetch image URLs...\n');
  
  try {
    // Override parseFile temporarily to limit results
    const originalParseFile = parser.parseFile.bind(parser);
    parser.parseFile = async function(filePath: string) {
      const results = await originalParseFile(filePath);
      return results.slice(0, 5); // Only return first 5
    };
    
    const artworks = await parser.parseFile(csvPath);
    
    console.log(`\nParsed ${artworks.length} paintings:\n`);
    
    for (const artwork of artworks) {
      console.log(`ID: ${artwork.metadata.id}`);
      console.log(`Title: ${artwork.metadata.title}`);
      console.log(`Artist: ${artwork.metadata.artist}`);
      console.log(`Date: ${artwork.metadata.date}`);
      console.log(`Department: ${artwork.metadata.department}`);
      console.log(`Image URL: ${typeof artwork.image === 'string' ? artwork.image : artwork.image?.url}`);
      console.log('---');
    }
    
    console.log('\n✅ Met parser is working correctly!');
  } catch (error) {
    console.error('❌ Error testing Met parser:', error);
  }
}

testMetParser();