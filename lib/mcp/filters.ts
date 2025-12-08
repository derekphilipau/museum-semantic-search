import { SearchFilters } from '@/lib/elasticsearch/client';
import { MCPFilters } from './types';

/**
 * Convert MCP filter format to internal SearchFilters format.
 * Handles undefined/null values and empty arrays.
 */
export function convertFilters(filters?: MCPFilters): SearchFilters {
  if (!filters) return {};

  const searchFilters: SearchFilters = {};

  if (filters.artistName) searchFilters.artistName = filters.artistName;
  if (filters.yearStart !== undefined) searchFilters.yearStart = filters.yearStart;
  if (filters.yearEnd !== undefined) searchFilters.yearEnd = filters.yearEnd;
  if (filters.medium) searchFilters.medium = filters.medium;
  if (filters.classification) searchFilters.classification = filters.classification;
  if (filters.department) searchFilters.department = filters.department;
  if (filters.tags && filters.tags.length > 0) searchFilters.tags = filters.tags;
  if (filters.culture) searchFilters.culture = filters.culture;
  if (filters.country) searchFilters.country = filters.country;
  if (filters.onView !== undefined) searchFilters.onView = filters.onView;
  if (filters.isPublicDomain !== undefined) searchFilters.isPublicDomain = filters.isPublicDomain;

  return searchFilters;
}

/**
 * Build a filters_applied object for API responses.
 * Only includes filters that were actually set.
 */
export function buildFiltersApplied(
  filters: SearchFilters
): Record<string, string | number | boolean | string[]> {
  const applied: Record<string, string | number | boolean | string[]> = {};

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined) {
      applied[key] = value as string | number | boolean | string[];
    }
  });

  return applied;
}
