#!/usr/bin/env node
/**
 * Generates high-quality similar artwork recommendations using LLM filtering
 * 
 * This script:
 * 1. Queries Elasticsearch for similarity candidates using 3 algorithms
 * 2. Uses Gemini to filter and rank the best matches
 * 3. Outputs a curated list of truly similar artworks with explanations
 */

import { loadEnvConfig } from '@next/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { parseArgs } from 'util';
import { getElasticsearchClient, INDEX_NAME, findSimilarArtworks, findMetadataSimilarArtworks } from '../../lib/elasticsearch/client';
import { Artwork } from '../../app/types';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables
const projectDir = path.join(__dirname, '../..');
loadEnvConfig(projectDir);

interface SimilarArtwork {
  id: string;
  similarity_type: string; // style, subject, mood, technique, period, multiple
  confidence: number; // 0-1
  explanation: string;
  source: string; // metadata, jina_v3, siglip2
}

interface ProcessedRecord {
  id: string;
  similar_artworks: SimilarArtwork[];
  generated_at: string;
}

interface CandidateArtwork {
  id: string;
  score: number;
  source: 'metadata' | 'jina_v3' | 'siglip2';
  artwork?: Artwork;
}

const CANDIDATE_SIZE = 20; // Get top 20 from each algorithm
const IMAGE_EMBEDDINGS_CANDIDATE_SIZE = 5; // Only get top 5 from image-based embeddings
const MAX_SIMILAR = 20; // Maximum similar artworks to keep after filtering

class SimilarArtworkGenerator {
  private processedIds = new Set<string>();
  private outputPath: string;
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    
    // Initialize Gemini
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEMINI_API_KEY environment variable is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1, // Deterministic for reproducible results
        topK: 1,
        topP: 1,
        responseMimeType: "application/json" // Structured JSON output
      }
    });
  }

  async loadExistingData(): Promise<void> {
    try {
      await fs.access(this.outputPath);
      const fileStream = createReadStream(this.outputPath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const record = JSON.parse(line) as ProcessedRecord;
            this.processedIds.add(record.id);
          } catch (e) {
            console.error('Error parsing line:', e);
          }
        }
      }
      
      console.log(`Loaded ${this.processedIds.size} already processed artworks`);
    } catch (error) {
      console.log('No existing file found, starting fresh');
    }
  }

  async getAllArtworkIds(): Promise<string[]> {
    const client = getElasticsearchClient();
    const artworkIds: string[] = [];
    
    console.log('Fetching all artwork IDs from Elasticsearch...');
    
    // Use scroll API for efficient retrieval
    const response = await client.search({
      index: INDEX_NAME,
      scroll: '1m',
      size: 1000,
      _source: false,
      query: { match_all: {} }
    });
    
    let scrollId = response._scroll_id;
    let hits = response.hits.hits;
    
    while (hits.length > 0) {
      artworkIds.push(...hits.map(hit => hit._id).filter((id): id is string => id !== undefined));
      
      const scrollResponse = await client.scroll({
        scroll_id: scrollId!,
        scroll: '1m'
      });
      
      scrollId = scrollResponse._scroll_id;
      hits = scrollResponse.hits.hits;
    }
    
    // Clear scroll
    if (scrollId) {
      await client.clearScroll({ scroll_id: scrollId });
    }
    
    console.log(`Found ${artworkIds.length} total artworks`);
    return artworkIds;
  }

  async fetchCandidates(artworkId: string): Promise<{
    sourceArtwork: Artwork | null;
    candidates: CandidateArtwork[];
  }> {
    const client = getElasticsearchClient();
    const candidates: CandidateArtwork[] = [];
    
    try {
      // Get source artwork
      const sourceResponse = await client.get({
        index: INDEX_NAME,
        id: artworkId,
        _source_excludes: ['embeddings']
      });
      const sourceArtwork = sourceResponse._source as Artwork;
      
      // Fetch candidates from all three algorithms
      const [metadataResults, jinaResults, siglipResults] = await Promise.all([
        findMetadataSimilarArtworks(artworkId, CANDIDATE_SIZE),
        findSimilarArtworks(artworkId, 'jina_v3', CANDIDATE_SIZE),
        findSimilarArtworks(artworkId, 'siglip2', IMAGE_EMBEDDINGS_CANDIDATE_SIZE)
      ]);
      
      // Add metadata candidates
      metadataResults.hits.forEach(hit => {
        candidates.push({
          id: hit._id,
          score: hit._score,
          source: 'metadata',
          artwork: hit._source as Artwork
        });
      });
      
      // Add Jina candidates
      jinaResults.hits.forEach(hit => {
        candidates.push({
          id: hit._id,
          score: hit._score,
          source: 'jina_v3',
          artwork: hit._source as Artwork
        });
      });
      
      // Add SigLIP2 candidates
      siglipResults.hits.forEach(hit => {
        candidates.push({
          id: hit._id,
          score: hit._score,
          source: 'siglip2',
          artwork: hit._source as Artwork
        });
      });
      
      console.log(`  Found ${candidates.length} candidates (${metadataResults.hits.length} metadata, ${jinaResults.hits.length} jina, ${siglipResults.hits.length} siglip2)`);
      
      return { sourceArtwork, candidates };
    } catch (error) {
      console.error(`Error fetching candidates for ${artworkId}:`, error);
      return { sourceArtwork: null, candidates: [] };
    }
  }

  formatArtworkForPrompt(artwork: Artwork): string {
    // Prefer long_description, fall back to alt_text, or indicate no description
    const description = artwork.visual_description?.long_description || 
                       artwork.visual_description?.alt_text || 
                       'No description available';
    
    return `ID: ${artwork.id}
Title: ${artwork.title}
Artist: ${artwork.artist} ${artwork.artistNationality ? `(${artwork.artistNationality})` : ''}
Date: ${artwork.date}
Medium: ${artwork.medium}
Department: ${artwork.department}
Classification: ${artwork.classification}
Culture: ${artwork.culture || 'N/A'}
Period: ${artwork.period || 'N/A'}
Description: ${description}`;
  }

  async filterWithLLM(
    sourceArtwork: Artwork, 
    candidates: CandidateArtwork[]
  ): Promise<SimilarArtwork[]> {
    // Remove duplicates, keeping highest score per artwork
    const uniqueCandidates = new Map<string, CandidateArtwork>();
    candidates.forEach(candidate => {
      const existing = uniqueCandidates.get(candidate.id);
      if (!existing || candidate.score > existing.score) {
        uniqueCandidates.set(candidate.id, candidate);
      }
    });
    
    const dedupedCandidates = Array.from(uniqueCandidates.values());
    console.log(`  Deduped to ${dedupedCandidates.length} unique candidates`);
    
    if (dedupedCandidates.length === 0) {
      return [];
    }
    
    // Format prompt
    const sourceFormatted = this.formatArtworkForPrompt(sourceArtwork);
    
    // Format candidates WITHOUT scores to avoid bias
    const candidatesFormatted = dedupedCandidates
      .map((c) => {
        if (!c.artwork) return '';
        return `
${this.formatArtworkForPrompt(c.artwork)}
---`;
      })
      .filter(s => s)
      .join('\n');
    
    const prompt = `You are an art historian helping to find truly similar artworks. Given a source artwork and candidate similar artworks, select only those with meaningful connections.

SOURCE ARTWORK:
${sourceFormatted}

CANDIDATE ARTWORKS:
${candidatesFormatted}

Please evaluate each candidate and select ONLY those with meaningful artistic, thematic, or stylistic connections. For each selected artwork, provide:
1. The artwork ID (as shown in the candidate)
2. Similarity type: one of (style, subject, mood, technique, period, multiple)
3. Confidence score (0-1, where 1 is extremely similar)
4. Brief explanation (max 100 characters)

Criteria for selection:
- Style: Similar artistic approach, brushwork, composition
- Subject: Similar themes, motifs, or depicted content
- Mood: Similar emotional tone or atmosphere
- Technique: Similar materials or methods
- Period: From same artistic movement or era
- Multiple: Combines several types of similarity

Important guidelines:
- Artworks with multiple strong connections are preferred
- Do not give high confidence based solely on one criterion unless very strong
- Artworks can be similar across centuries and cultures if they share genuine thematic or visual elements
- Focus on what is actually depicted or described, not interpretive meanings

Be selective - only include artworks with confidence >= 0.7. Aim for quality over quantity - ideally select 20 of the most relevant artworks rather than listing all possible matches. Consider the artwork as a whole, looking for meaningful relationships that would help viewers discover related works they'd find interesting.

Use ONLY information provided in the artwork descriptions. Base connections on what is explicitly depicted or described, not on symbolic or interpretive meanings.

Format your response as a JSON array:
[
  {
    "id": "met_12345",
    "similarity_type": "style",
    "confidence": 0.85,
    "explanation": "Both use impressionist brushwork and similar color palette"
  }
]`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // Parse JSON directly (Gemini returns clean JSON with responseMimeType)
      let selectedCandidates;
      try {
        selectedCandidates = JSON.parse(response);
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        console.error('Response was:', response.substring(0, 500));
        return [];
      }
      
      // Create a map of candidate IDs to candidates for quick lookup
      const candidateMap = new Map(dedupedCandidates.map(c => [c.id, c]));
      
      // Map to our format using IDs
      const similarArtworks: SimilarArtwork[] = selectedCandidates
        .map((selected: any) => {
          const candidate = candidateMap.get(selected.id);
          if (!candidate) {
            console.warn(`LLM returned unknown artwork ID: ${selected.id}`);
            return null;
          }
          
          return {
            id: selected.id,
            similarity_type: selected.similarity_type,
            confidence: selected.confidence,
            explanation: selected.explanation,
            source: candidate.source
          };
        })
        .filter((a: SimilarArtwork | null): a is SimilarArtwork => a !== null)
        .sort((a: SimilarArtwork, b: SimilarArtwork) => b.confidence - a.confidence)
        .slice(0, MAX_SIMILAR);
      
      console.log(`  LLM selected ${similarArtworks.length} similar artworks`);
      
      // Simply enforce maximum limit
      return similarArtworks.slice(0, MAX_SIMILAR);
    } catch (error) {
      console.error('Error calling LLM:', error);
      return [];
    }
  }

  async processArtwork(artworkId: string): Promise<ProcessedRecord | null> {
    console.log(`Processing ${artworkId}...`);
    
    // Fetch candidates
    const { sourceArtwork, candidates } = await this.fetchCandidates(artworkId);
    if (!sourceArtwork || candidates.length === 0) {
      console.log(`  Skipping - no source artwork or candidates`);
      return null;
    }
    
    // Filter with LLM
    const similarArtworks = await this.filterWithLLM(sourceArtwork, candidates);
    
    return {
      id: artworkId,
      similar_artworks: similarArtworks,
      generated_at: new Date().toISOString()
    };
  }

  async saveRecord(record: ProcessedRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.outputPath, line);
  }

  async processAllArtworks(artworkIds?: string[], limit?: number): Promise<void> {
    // Get all artwork IDs if not provided
    if (!artworkIds) {
      artworkIds = await this.getAllArtworkIds();
    }
    
    // Filter out already processed
    const toProcess = artworkIds.filter(id => !this.processedIds.has(id));
    console.log(`\nFound ${toProcess.length} artworks to process`);
    
    if (toProcess.length === 0) {
      console.log('All artworks already processed!');
      return;
    }
    
    // Apply limit if specified
    const processLimit = limit ? Math.min(limit, toProcess.length) : toProcess.length;
    console.log(`Processing ${processLimit} artworks...\n`);
    
    let processed = 0;
    let errors = 0;
    
    for (const artworkId of toProcess.slice(0, processLimit)) {
      try {
        const record = await this.processArtwork(artworkId);
        if (record) {
          await this.saveRecord(record);
          this.processedIds.add(artworkId);
        }
        processed++;
        
        if (processed % 10 === 0) {
          console.log(`Progress: ${processed}/${processLimit} processed`);
        }
        
        // Rate limiting - Gemini has generous limits but let's be respectful
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      } catch (error) {
        console.error(`Error processing ${artworkId}:`, error);
        errors++;
        
        // Longer delay on error
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`\nCompleted! Processed: ${processed}, Errors: ${errors}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', short: 'l' },
      'artwork-ids': { type: 'string' },
      'batch-size': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  
  if (values.help) {
    console.log(`
Generate Similar Artworks with LLM Filtering

This script queries Elasticsearch for similarity candidates and uses
Gemini to select only the most relevant matches.

Usage: npm run 7-generate-similar-artworks-met -- [options]

Options:
  -l, --limit <n>         Process only first n artworks
  --artwork-ids <ids>     Process specific artwork IDs (comma-separated)
  --batch-size <n>        Not used (kept for compatibility)
  -h, --help             Show this help

Examples:
  # Process all artworks
  npm run 7-generate-similar-artworks-met
  
  # Process first 100 artworks
  npm run 7-generate-similar-artworks-met -- --limit 100
  
  # Process specific artworks
  npm run 7-generate-similar-artworks-met -- --artwork-ids met_12345,met_67890

The script is idempotent and can be safely interrupted and resumed.
`);
    process.exit(0);
  }
  
  const outputPath = path.join(__dirname, '../../data/met/similar_artworks.jsonl');
  const generator = new SimilarArtworkGenerator(outputPath);
  
  // Load existing data
  await generator.loadExistingData();
  
  // Process artworks
  const artworkIds = values['artwork-ids']?.split(',').map(id => id.trim());
  const limit = values.limit ? parseInt(values.limit) : undefined;
  
  await generator.processAllArtworks(artworkIds, limit);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}