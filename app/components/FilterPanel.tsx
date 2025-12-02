'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, X, Filter, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// Types
export interface FilterOptions {
  departments: { value: string; count: number }[];
  classifications: { value: string; count: number }[];
  cultures: { value: string; count: number }[];
  tags: { value: string; count: number }[];
  dateRange: { min: number; max: number };
}

export interface SearchFilters {
  artistName?: string;
  yearStart?: number;
  yearEnd?: number;
  medium?: string;
  classification?: string;
  department?: string;
  tags?: string[];
  culture?: string;
  country?: string;
  onView?: boolean;
  isPublicDomain?: boolean;
}

interface FilterPanelProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  disabled?: boolean;
}

// Helper to count active filters
function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.artistName) count++;
  if (filters.yearStart !== undefined || filters.yearEnd !== undefined) count++;
  if (filters.department) count++;
  if (filters.classification) count++;
  if (filters.culture) count++;
  if (filters.tags && filters.tags.length > 0) count++;
  if (filters.onView) count++;
  if (filters.isPublicDomain) count++;
  return count;
}

// Helper to check if draft differs from applied filters
function filtersChanged(draft: SearchFilters, applied: SearchFilters): boolean {
  const draftKeys = Object.keys(draft).filter(k => {
    const val = draft[k as keyof SearchFilters];
    return val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
  });
  const appliedKeys = Object.keys(applied).filter(k => {
    const val = applied[k as keyof SearchFilters];
    return val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
  });

  if (draftKeys.length !== appliedKeys.length) return true;

  for (const key of draftKeys) {
    const draftVal = draft[key as keyof SearchFilters];
    const appliedVal = applied[key as keyof SearchFilters];
    if (Array.isArray(draftVal) && Array.isArray(appliedVal)) {
      if (draftVal.length !== appliedVal.length || !draftVal.every((v, i) => v === appliedVal[i])) {
        return true;
      }
    } else if (draftVal !== appliedVal) {
      return true;
    }
  }
  return false;
}

export default function FilterPanel({ filters, onChange, disabled }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Local draft state for form inputs (not applied until user clicks button)
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(filters);

  // Sync draft with applied filters when they change externally
  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  // Fetch filter options on first open
  useEffect(() => {
    if (isOpen && !filterOptions && !isLoading) {
      setIsLoading(true);
      fetch('/api/filters')
        .then(res => res.json())
        .then(data => {
          setFilterOptions(data);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Failed to load filter options:', err);
          setIsLoading(false);
        });
    }
  }, [isOpen, filterOptions, isLoading]);

  const activeFilterCount = countActiveFilters(filters);
  const hasChanges = filtersChanged(draftFilters, filters);

  // Clear all filters (applies immediately)
  const handleClearAll = () => {
    setDraftFilters({});
    onChange({});
  };

  // Update draft filter (does NOT trigger search)
  const updateDraftFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setDraftFilters(prev => {
      const newFilters = { ...prev };
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        delete newFilters[key];
      } else {
        newFilters[key] = value;
      }
      return newFilters;
    });
  };

  // Remove a filter from applied filters (triggers search immediately)
  const removeAppliedFilter = <K extends keyof SearchFilters>(key: K) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onChange(newFilters);
  };

  // Apply draft filters (triggers search)
  const applyFilters = () => {
    onChange(draftFilters);
  };

  const toggleDraftTag = (tag: string) => {
    const currentTags = draftFilters.tags || [];
    if (currentTags.includes(tag)) {
      updateDraftFilter('tags', currentTags.filter(t => t !== tag));
    } else {
      updateDraftFilter('tags', [...currentTags, tag]);
    }
  };

  // Date range values with defaults
  const dateMin = filterOptions?.dateRange.min ?? -3000;
  const dateMax = filterOptions?.dateRange.max ?? new Date().getFullYear();
  const yearStart = draftFilters.yearStart ?? dateMin;
  const yearEnd = draftFilters.yearEnd ?? dateMax;

  // Build list of active filter badges (from APPLIED filters, not draft)
  const activeFilterBadges: { label: string; key: string; onRemove: () => void }[] = [];

  if (filters.artistName) {
    activeFilterBadges.push({
      label: `Artist: ${filters.artistName}`,
      key: 'artistName',
      onRemove: () => removeAppliedFilter('artistName'),
    });
  }
  if (filters.yearStart !== undefined || filters.yearEnd !== undefined) {
    const start = filters.yearStart ?? 'any';
    const end = filters.yearEnd ?? 'any';
    activeFilterBadges.push({
      label: `Date: ${start} - ${end}`,
      key: 'dateRange',
      onRemove: () => {
        const newFilters = { ...filters };
        delete newFilters.yearStart;
        delete newFilters.yearEnd;
        onChange(newFilters);
      },
    });
  }
  if (filters.department) {
    activeFilterBadges.push({
      label: `Dept: ${filters.department}`,
      key: 'department',
      onRemove: () => removeAppliedFilter('department'),
    });
  }
  if (filters.classification) {
    activeFilterBadges.push({
      label: `Type: ${filters.classification}`,
      key: 'classification',
      onRemove: () => removeAppliedFilter('classification'),
    });
  }
  if (filters.culture) {
    activeFilterBadges.push({
      label: `Culture: ${filters.culture}`,
      key: 'culture',
      onRemove: () => removeAppliedFilter('culture'),
    });
  }
  if (filters.tags && filters.tags.length > 0) {
    filters.tags.forEach((tag) => {
      activeFilterBadges.push({
        label: tag,
        key: `tag-${tag}`,
        onRemove: () => {
          const newFilters = { ...filters, tags: filters.tags?.filter(t => t !== tag) };
          if (newFilters.tags?.length === 0) delete newFilters.tags;
          onChange(newFilters);
        },
      });
    });
  }
  if (filters.isPublicDomain) {
    activeFilterBadges.push({
      label: 'Public Domain',
      key: 'isPublicDomain',
      onRemove: () => removeAppliedFilter('isPublicDomain'),
    });
  }
  if (filters.onView) {
    activeFilterBadges.push({
      label: 'On View',
      key: 'onView',
      onRemove: () => removeAppliedFilter('onView'),
    });
  }

  return (
    <div className="space-y-2">
      {/* Active filter badges - always visible when filters are active */}
      {activeFilterBadges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterBadges.map((badge) => (
            <Badge
              key={badge.key}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
              onClick={badge.onRemove}
            >
              {badge.label}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </Button>
        </div>
      )}

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-2">
            <Filter className="h-4 w-4" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">
                {activeFilterCount}
              </Badge>
            )}
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Loading filter options...
          </div>
        ) : (
          <div className="grid gap-4 rounded-lg border p-4 bg-muted/30">
            {/* Row 1: Artist and Date Range */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Artist Name */}
              <div className="space-y-2">
                <Label htmlFor="artistName" className="text-sm">
                  Artist
                </Label>
                <Input
                  id="artistName"
                  placeholder="e.g., Van Gogh, Rembrandt"
                  value={draftFilters.artistName || ''}
                  onChange={(e) => updateDraftFilter('artistName', e.target.value || undefined)}
                  disabled={disabled}
                  className="h-9"
                />
              </div>

              {/* Date Range */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Date Range</Label>
                  <span className="text-xs text-muted-foreground">
                    {yearStart} - {yearEnd}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="From"
                    value={draftFilters.yearStart ?? ''}
                    onChange={(e) => updateDraftFilter('yearStart', e.target.value ? parseInt(e.target.value) : undefined)}
                    disabled={disabled}
                    className="h-9 w-24"
                  />
                  <span className="text-muted-foreground">-</span>
                  <Input
                    type="number"
                    placeholder="To"
                    value={draftFilters.yearEnd ?? ''}
                    onChange={(e) => updateDraftFilter('yearEnd', e.target.value ? parseInt(e.target.value) : undefined)}
                    disabled={disabled}
                    className="h-9 w-24"
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Dropdowns */}
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Department */}
              <div className="space-y-2">
                <Label className="text-sm">Department</Label>
                <Select
                  value={draftFilters.department || '__any__'}
                  onValueChange={(value) => updateDraftFilter('department', value === '__any__' ? undefined : value)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Any department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any department</SelectItem>
                    {filterOptions?.departments.filter(dept => dept.value).map((dept) => (
                      <SelectItem key={dept.value} value={dept.value}>
                        {dept.value} ({dept.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Classification */}
              <div className="space-y-2">
                <Label className="text-sm">Classification</Label>
                <Select
                  value={draftFilters.classification || '__any__'}
                  onValueChange={(value) => updateDraftFilter('classification', value === '__any__' ? undefined : value)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Any type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any type</SelectItem>
                    {filterOptions?.classifications.filter(cls => cls.value).map((cls) => (
                      <SelectItem key={cls.value} value={cls.value}>
                        {cls.value} ({cls.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Culture */}
              <div className="space-y-2">
                <Label className="text-sm">Culture</Label>
                <Select
                  value={draftFilters.culture || '__any__'}
                  onValueChange={(value) => updateDraftFilter('culture', value === '__any__' ? undefined : value)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Any culture" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any culture</SelectItem>
                    {filterOptions?.cultures.filter(c => c.value).slice(0, 50).map((culture) => (
                      <SelectItem key={culture.value} value={culture.value}>
                        {culture.value} ({culture.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Tags */}
            <div className="space-y-2">
              <Label className="text-sm">Tags</Label>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded border bg-background">
                {filterOptions?.tags.filter(t => t.value).slice(0, 30).map((tag) => {
                  const isSelected = draftFilters.tags?.includes(tag.value);
                  return (
                    <Badge
                      key={tag.value}
                      variant={isSelected ? 'default' : 'outline'}
                      className={`cursor-pointer text-xs ${
                        isSelected ? '' : 'hover:bg-accent'
                      }`}
                      onClick={() => !disabled && toggleDraftTag(tag.value)}
                    >
                      {tag.value}
                      {isSelected && (
                        <X className="ml-1 h-3 w-3" />
                      )}
                    </Badge>
                  );
                })}
                {!filterOptions && (
                  <span className="text-xs text-muted-foreground">Loading tags...</span>
                )}
              </div>
            </div>

            {/* Row 4: Checkboxes and Apply Button */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isPublicDomain"
                    checked={draftFilters.isPublicDomain || false}
                    onCheckedChange={(checked) =>
                      updateDraftFilter('isPublicDomain', checked ? true : undefined)
                    }
                    disabled={disabled}
                  />
                  <Label htmlFor="isPublicDomain" className="text-sm cursor-pointer">
                    Public Domain only
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="onView"
                    checked={draftFilters.onView || false}
                    onCheckedChange={(checked) =>
                      updateDraftFilter('onView', checked ? true : undefined)
                    }
                    disabled={disabled}
                  />
                  <Label htmlFor="onView" className="text-sm cursor-pointer">
                    Currently on view
                  </Label>
                </div>
              </div>

              {/* Apply Filters Button */}
              <Button
                type="button"
                onClick={applyFilters}
                disabled={disabled || !hasChanges}
                size="sm"
                className="gap-2"
              >
                <Search className="h-4 w-4" />
                Apply Filters
              </Button>
            </div>
          </div>
        )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
