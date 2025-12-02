/**
 * Composable search filters for Elasticsearch queries.
 * These filters can be applied to keyword, semantic, and hybrid searches.
 */

/**
 * Search filters that can be applied to any search type.
 * All filters are optional - only specified filters are applied.
 */
export interface SearchFilters {
  // Artist filtering (searches nested artists array)
  artistName?: string;           // Fuzzy match on artist display name
  artistId?: string;             // Exact match on constituent ID

  // Date range (uses dateBegin/dateEnd fields)
  yearStart?: number;            // e.g., 1850
  yearEnd?: number;              // e.g., 1900

  // Material/medium (fuzzy match)
  medium?: string;               // e.g., "oil on canvas", "bronze"

  // Classification (exact match)
  classification?: string;       // e.g., "Paintings", "Sculpture"

  // Department (exact match)
  department?: string;           // e.g., "European Paintings"

  // Tags (exact match, supports multiple)
  tags?: string[];               // e.g., ["Portraits", "Women"]
  tagsMatchAll?: boolean;        // true = AND, false = OR (default: true)

  // Culture/origin
  culture?: string;              // e.g., "French", "Japanese"
  country?: string;              // e.g., "France", "Japan"

  // Status flags
  isHighlight?: boolean;         // Only highlighted works
  isPublicDomain?: boolean;      // Only public domain works
  onView?: boolean;              // Only works currently on display
}

/**
 * Builds Elasticsearch filter clauses from SearchFilters.
 * Returns an array of filter clauses to be used in a bool query's filter array.
 *
 * For keyword search: use in bool.filter
 * For semantic (kNN) search: wrap in { bool: { must: [...] } } for knn.filter
 */
export function buildFilterClauses(filters: SearchFilters): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [];

  // Artist name - nested query with fuzzy matching
  if (filters.artistName) {
    clauses.push({
      nested: {
        path: 'artists',
        query: {
          match: {
            'artists.displayName': {
              query: filters.artistName,
              fuzziness: 'AUTO'
            }
          }
        }
      }
    });
  }

  // Artist ID - exact match on nested field
  if (filters.artistId) {
    clauses.push({
      nested: {
        path: 'artists',
        query: {
          term: {
            'artists.constituentId': filters.artistId
          }
        }
      }
    });
  }

  // Date range filter
  // We filter on dateBegin to find works that started within the range
  if (filters.yearStart !== undefined || filters.yearEnd !== undefined) {
    const rangeQuery: Record<string, number> = {};
    if (filters.yearStart !== undefined) {
      rangeQuery.gte = filters.yearStart;
    }
    if (filters.yearEnd !== undefined) {
      rangeQuery.lte = filters.yearEnd;
    }
    clauses.push({
      range: {
        dateBegin: rangeQuery
      }
    });
  }

  // Medium - fuzzy match (text field)
  if (filters.medium) {
    clauses.push({
      match: {
        medium: {
          query: filters.medium,
          fuzziness: 'AUTO'
        }
      }
    });
  }

  // Classification - exact match (keyword field)
  if (filters.classification) {
    clauses.push({
      term: {
        classification: filters.classification
      }
    });
  }

  // Department - exact match (keyword field)
  if (filters.department) {
    clauses.push({
      term: {
        department: filters.department
      }
    });
  }

  // Tags - exact match on keyword array field
  if (filters.tags && filters.tags.length > 0) {
    if (filters.tagsMatchAll !== false) {
      // AND logic - must have ALL tags (default)
      filters.tags.forEach(tag => {
        clauses.push({ term: { tags: tag } });
      });
    } else {
      // OR logic - must have at least one tag
      clauses.push({
        bool: {
          should: filters.tags.map(tag => ({ term: { tags: tag } })),
          minimum_should_match: 1
        }
      });
    }
  }

  // Culture - exact match (keyword field)
  if (filters.culture) {
    clauses.push({
      term: {
        culture: filters.culture
      }
    });
  }

  // Country - exact match (keyword field)
  if (filters.country) {
    clauses.push({
      term: {
        country: filters.country
      }
    });
  }

  // Boolean flags
  if (filters.isHighlight !== undefined) {
    clauses.push({ term: { isHighlight: filters.isHighlight } });
  }
  if (filters.isPublicDomain !== undefined) {
    clauses.push({ term: { isPublicDomain: filters.isPublicDomain } });
  }
  if (filters.onView !== undefined) {
    clauses.push({ term: { onView: filters.onView } });
  }

  return clauses;
}

/**
 * Checks if any filters are actually specified.
 * Useful to avoid adding empty filter arrays to queries.
 */
export function hasFilters(filters?: SearchFilters): boolean {
  if (!filters) return false;

  return (
    filters.artistName !== undefined ||
    filters.artistId !== undefined ||
    filters.yearStart !== undefined ||
    filters.yearEnd !== undefined ||
    filters.medium !== undefined ||
    filters.classification !== undefined ||
    filters.department !== undefined ||
    (filters.tags !== undefined && filters.tags.length > 0) ||
    filters.culture !== undefined ||
    filters.country !== undefined ||
    filters.isHighlight !== undefined ||
    filters.isPublicDomain !== undefined ||
    filters.onView !== undefined
  );
}
