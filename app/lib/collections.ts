// Collection configuration and metadata

export const COLLECTION_IDS = {
  MOMA: 'moma',
  MET: 'met',
} as const;

export type CollectionId = typeof COLLECTION_IDS[keyof typeof COLLECTION_IDS];

export interface CollectionMetadata {
  id: CollectionId;
  displayName: string;
  shortName: string;
  website: string;
  description: string;
  apiUrl?: string;
  color?: string;
  logo?: string;
}

export const COLLECTIONS: Record<CollectionId, CollectionMetadata> = {
  [COLLECTION_IDS.MOMA]: {
    id: COLLECTION_IDS.MOMA,
    displayName: 'Museum of Modern Art',
    shortName: 'MoMA',
    website: 'https://www.moma.org',
    description: 'The Museum of Modern Art in New York City',
    apiUrl: 'https://api.moma.org',
    color: '#000000',
  },
  [COLLECTION_IDS.MET]: {
    id: COLLECTION_IDS.MET,
    displayName: 'The Metropolitan Museum of Art',
    shortName: 'The Met',
    website: 'https://www.metmuseum.org',
    description: 'The Metropolitan Museum of Art in New York City',
    apiUrl: 'https://collectionapi.metmuseum.org',
    color: '#E4002B',
  },
};

// Helper functions
export function getCollectionById(id: string): CollectionMetadata | undefined {
  return COLLECTIONS[id as CollectionId];
}

export function getCollectionDisplayName(id: string): string {
  const collection = getCollectionById(id);
  return collection?.displayName || id;
}

export function getCollectionShortName(id: string): string {
  const collection = getCollectionById(id);
  return collection?.shortName || id;
}

export function getCollectionWebsiteUrl(id: string): string {
  const collection = getCollectionById(id);
  return collection?.website || '';
}

export function isValidCollectionId(id: string): id is CollectionId {
  return Object.values(COLLECTION_IDS).includes(id as CollectionId);
}

export function getAllCollectionIds(): CollectionId[] {
  return Object.values(COLLECTION_IDS);
}

export function getAllCollections(): CollectionMetadata[] {
  return Object.values(COLLECTIONS);
}