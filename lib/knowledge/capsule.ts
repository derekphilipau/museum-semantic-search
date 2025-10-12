import fs from 'fs/promises';
import path from 'path';

export interface CapsuleRelatedEntity {
  label: string;
  entity_id: string;
  relation?: string;
  description?: string;
}

export interface CapsuleDocument {
  doc_id: string;
  capsule_family?: string;
  source_title?: string;
  source_type?: string;
  source_url?: string;
  source_retrieved?: string;
  source_license?: string;
  source_note?: string;
  section_count?: number;
  snippet_ids?: string[];
  entity_ids?: string[];
}

export interface CapsuleSnippetStats {
  total_snippets?: number;
  by_family?: Record<string, number>;
  by_source?: Record<string, number>;
}

export interface CapsuleBuildInfo {
  generated_at?: string;
  version?: string;
  script?: string;
}

export interface KnowledgeCapsule {
  artifact_id: string;
  title?: string;
  wikidata_id?: string;
  core_facts?: Record<string, unknown>;
  related_entities?: CapsuleRelatedEntity[];
  documents?: CapsuleDocument[];
  snippet_stats?: CapsuleSnippetStats;
  build?: CapsuleBuildInfo;
}

const CAPSULE_DIR = path.join(
  process.cwd(),
  'data',
  'trusted_corpus',
  'capsules'
);

export async function loadKnowledgeCapsule(
  artifactId: string
): Promise<KnowledgeCapsule | null> {
  const filePath = path.join(CAPSULE_DIR, `${artifactId}.json`);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const capsule = JSON.parse(raw) as KnowledgeCapsule;
    return capsule;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }

    console.error(`Failed to load knowledge capsule for ${artifactId}:`, error);
    return null;
  }
}
