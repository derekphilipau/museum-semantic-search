'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ProjectionPoint, ProjectionType, EmbeddingType, ColorByOption, DisplayMode } from '@/app/types';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import * as d3 from 'd3';
import debounce from 'lodash/debounce';
import { ArtworkTooltip } from './ArtworkTooltipPortal';

interface SearchResult {
  id: string;
  score: number;
}

interface EmbeddingVisualizationProps {
  embeddingType: EmbeddingType;
  projectionType: ProjectionType;
  colorBy: ColorByOption;
  displayMode: DisplayMode;
  searchResults?: SearchResult[];
  onDataLoaded?: (count: number) => void;
  highlightedArtworkId?: string | null;
}

export function EmbeddingVisualization({
  embeddingType,
  projectionType,
  colorBy,
  displayMode,
  searchResults = [],
  onDataLoaded,
  highlightedArtworkId
}: EmbeddingVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ProjectionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<ProjectionPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  
  // D3 zoom behavior ref
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  // Ref for hovered point to avoid re-initializing zoom
  const hoveredPointRef = useRef<ProjectionPoint | null>(null);
  
  // Reset zoom function
  const resetZoom = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !zoomRef.current) return;
    
    const rect = canvas.getBoundingClientRect();
    const newTransform = d3.zoomIdentity
      .translate(rect.width / 2, rect.height / 2)
      .scale(1.2);
    setTransform(newTransform);
    d3.select(container)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, newTransform);
  }, []);
  
  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Use ES endpoint instead of file-based endpoint
        const response = await fetch(
          `/api/projections/es?embeddingType=${embeddingType}&projectionType=${projectionType}&t=${Date.now()}`
        );
        const result = await response.json();
        
        if (result.points) {
          // Process points for canvas coordinates
          const processedPoints = processPoints(result.points);
          setData(processedPoints);
          onDataLoaded?.(processedPoints.length);
        }
      } catch (error) {
        console.error('Error loading projection data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [embeddingType, projectionType, onDataLoaded]);
  
  // Process points to normalize coordinates
  const processPoints = (points: ProjectionPoint[]): ProjectionPoint[] => {
    const xValues = points.map(p => p.coordinates[0]);
    const yValues = points.map(p => p.coordinates[1]);
    
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const maxRange = Math.max(xRange, yRange);
    
    return points.map(point => ({
      ...point,
      // Store normalized coordinates for easier rendering
      normalizedCoords: [
        (point.coordinates[0] - xMin) / maxRange,
        (point.coordinates[1] - yMin) / maxRange
      ]
    }));
  };
  
  // Create search results map for faster lookup
  const searchResultsMap = useMemo(() => {
    const map = new Map<string, number>();
    searchResults.forEach(result => {
      map.set(result.id, result.score);
    });
    return map;
  }, [searchResults]);

  // Track previous search to detect changes
  const prevSearchResultsRef = useRef<typeof searchResults>([]);
  
  // Zoom to search results
  useEffect(() => {
    if (searchResults.length === 0 || data.length === 0 || canvasSize.width === 0 || !zoomRef.current) return;
    
    // Check if search results have actually changed
    const searchChanged = searchResults.length !== prevSearchResultsRef.current.length ||
      searchResults.some((r, i) => r.id !== prevSearchResultsRef.current[i]?.id);
    
    if (!searchChanged) return;
    
    // Update previous search results
    prevSearchResultsRef.current = searchResults;
    
    // Find bounds of search results
    const resultPoints = data.filter(point => searchResultsMap.has(point.artwork_id));
    if (resultPoints.length === 0) return;
    
    const xCoords = resultPoints.map(p => ((p.normalizedCoords?.[0] || 0) - 0.5) * canvasSize.width * 0.8);
    const yCoords = resultPoints.map(p => ((p.normalizedCoords?.[1] || 0) - 0.5) * canvasSize.height * 0.8);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Avoid zooming if dimensions are too small
    if (width < 10 || height < 10) return;
    
    // Calculate zoom level to fit results with padding
    const padding = 100;
    const scaleX = (canvasSize.width - padding) / width;
    const scaleY = (canvasSize.height - padding) / height;
    const targetScale = Math.max(1.2, Math.min(scaleX, scaleY, 5)); // Min zoom of 1.2x, max zoom of 5x
    
    // Calculate translation to center the results
    const targetTranslateX = canvasSize.width / 2 - centerX * targetScale;
    const targetTranslateY = canvasSize.height / 2 - centerY * targetScale;
    
    // Use d3-zoom to animate to the new transform
    const container = containerRef.current;
    if (container) {
      const newTransform = d3.zoomIdentity
        .translate(targetTranslateX, targetTranslateY)
        .scale(targetScale);
      setTransform(newTransform);
      d3.select(container)
        .transition()
        .duration(500)
        .call(zoomRef.current.transform, newTransform);
    }
  }, [searchResults, data, canvasSize.width, canvasSize.height, searchResultsMap]);

  // Update canvas size on mount and resize
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    
    updateCanvasSize();
    
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);
  
  // Calculate default transform for reset button visibility
  const getDefaultTransform = useCallback(() => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);
  
  // Update hovered point based on mouse position
  const updateHoveredPoint = useCallback((x: number, y: number, transform: d3.ZoomTransform) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Find all points within hover radius
    // Match the partial scaling of points
    const hoverRadius = 5 * Math.sqrt(transform.k) / transform.k;
    const candidates: Array<{point: ProjectionPoint, dist: number, score: number}> = [];
    
    for (const point of data) {
      const px = ((point.normalizedCoords?.[0] || 0) - 0.5) * rect.width * 0.8;
      const py = ((point.normalizedCoords?.[1] || 0) - 0.5) * rect.height * 0.8;
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      
      if (dist < hoverRadius) {
        const score = searchResultsMap.get(point.artwork_id) || 0;
        candidates.push({ point, dist, score });
      }
    }
    
    if (candidates.length > 0) {
      // Find which point is actually visible (drawn last) at the cursor position
      // We need to respect the same drawing order as in the render function
      const sortedCandidates = candidates.sort((a, b) => {
        // Always prefer highlighted point (drawn last)
        if (highlightedArtworkId === a.point.artwork_id) return -1;
        if (highlightedArtworkId === b.point.artwork_id) return 1;
        
        // Then sort by relevance score (higher scores drawn later, so should be selected)
        const scoreA = a.score;
        const scoreB = b.score;
        if (scoreA !== scoreB) {
          return scoreB - scoreA; // Higher scores first (drawn last, on top)
        }
        
        // If same score, closest to cursor
        return a.dist - b.dist;
      });
      
      // Select the first point (highest priority based on drawing order)
      const newHoveredPoint = sortedCandidates[0].point;
      hoveredPointRef.current = newHoveredPoint;
      setHoveredPoint(newHoveredPoint);
    } else {
      hoveredPointRef.current = null;
      setHoveredPoint(null);
    }
  }, [data, searchResultsMap, highlightedArtworkId]);
  
  // Initialize d3-zoom
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    
    // Create zoom behavior
    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([1.2, 200])
      .on('zoom', (event) => {
        setTransform(event.transform);
      });
    
    // Apply zoom behavior to container (not canvas)
    const selection = d3.select(container);
    selection.call(zoom);
    
    // Set initial transform with proper centering
    // The visualization is drawn centered at (0,0) with scale 0.8 of canvas size
    // So we need to translate to center of canvas
    const rect = canvas.getBoundingClientRect();
    const initialTransform = d3.zoomIdentity
      .translate(rect.width / 2, rect.height / 2)
      .scale(1.2);
    selection.call(zoom.transform, initialTransform);
    
    // Add mousemove handler for hover detection on canvas
    d3.select(canvas).on('mousemove.hover', (event) => {
      const [x, y] = d3.pointer(event);
      setMousePos({ x: event.clientX, y: event.clientY });
      
      const currentTransform = d3.zoomTransform(container);
      const worldX = (x - currentTransform.x) / currentTransform.k;
      const worldY = (y - currentTransform.y) / currentTransform.k;
      
      updateHoveredPoint(worldX, worldY, currentTransform);
    });
    
    // Add click handler on canvas
    d3.select(canvas).on('click.open', (event) => {
      // Prevent click from triggering during drag
      if (event.defaultPrevented) return;
      
      if (hoveredPointRef.current) {
        window.open(`/artwork/${hoveredPointRef.current.artwork_id}`, '_blank', 'noopener,noreferrer');
      }
    });
    
    // Store zoom behavior reference
    zoomRef.current = zoom;
    
    return () => {
      // Clean up all listeners
      selection.on('.zoom', null);
      d3.select(canvas).on('mousemove.hover', null);
      d3.select(canvas).on('click.open', null);
    };
  }, [updateHoveredPoint, data]);
  
  // Color utility functions
  const getColorValue = useCallback((point: ProjectionPoint, colorBy: ColorByOption): string => {
    const metadata = point.metadata;
    
    const extractPeriod = (date: string): string => {
      const match = date.match(/(\d{2})\d{2}/);
      if (match) {
        const century = parseInt(match[1]) + 1;
        return `${century}th century`;
      }
      return 'Unknown period';
    };
    
    switch (colorBy) {
      case 'artist':
        return metadata.artist || 'Unknown';
      case 'period':
        return extractPeriod(metadata.date || '');
      case 'tags':
        return metadata.tags[0] || 'Untagged';
      default:
        return '';
    }
  }, []);
  
  const createColorScale = useCallback((points: ProjectionPoint[], colorBy: ColorByOption) => {
    
    const values = new Set<string>();
    points.forEach(point => {
      const value = getColorValue(point, colorBy);
      if (value) values.add(value);
    });
    
    const uniqueValues = Array.from(values);
    const colors = [...d3.schemeCategory10, ...d3.schemePaired];
    
    const scale: Record<string, string> = {};
    uniqueValues.forEach((value, i) => {
      scale[value] = colors[i % colors.length];
    });
    
    return scale;
  }, [getColorValue]);
  
  const getPointColor = useCallback((
    point: ProjectionPoint,
    colorBy: ColorByOption,
    colorScale: Record<string, string> | null
  ): string => {
    if (!colorScale) return '#4a90e2';
    const value = getColorValue(point, colorBy);
    return colorScale[value] || '#999';
  }, [getColorValue]);
  
  // Image cache for thumbnails with visibility tracking
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const visibleImages = useRef<Set<string>>(new Set());
  
  // Trigger redraw flag
  const [redrawTrigger, setRedrawTrigger] = useState(0);
  
  // Debounced image loading function
  const loadVisibleImages = useMemo(
    () => debounce((
      data: ProjectionPoint[], 
      transform: d3.ZoomTransform,
      canvas: HTMLCanvasElement
    ) => {
      const rect = canvas.getBoundingClientRect();
      const visibleBounds = {
        minX: (-transform.x / transform.k - rect.width * 0.1) / (rect.width * 0.8) + 0.5,
        maxX: ((-transform.x + rect.width) / transform.k + rect.width * 0.1) / (rect.width * 0.8) + 0.5,
        minY: (-transform.y / transform.k - rect.height * 0.1) / (rect.height * 0.8) + 0.5,
        maxY: ((-transform.y + rect.height) / transform.k + rect.height * 0.1) / (rect.height * 0.8) + 0.5
      };
      
      // Track newly visible images
      const newVisibleImages = new Set<string>();
      
      // Adjust max images based on zoom level
      const MAX_IMAGES = Math.max(50, Math.min(300, Math.floor(200 / Math.sqrt(transform.k))));
      let imagesToLoad = 0;
      
      data.forEach(point => {
        // Check if point is in visible bounds
        const coords = point.normalizedCoords;
        if (!coords || 
            coords[0] < visibleBounds.minX || coords[0] > visibleBounds.maxX ||
            coords[1] < visibleBounds.minY || coords[1] > visibleBounds.maxY) {
          return;
        }
        
        // Get image URL from the image field
        let imageUrl = '';
        if (typeof point.metadata.image === 'string') {
          imageUrl = point.metadata.image;
        } else if (point.metadata.image?.thumbnailUrl) {
          imageUrl = point.metadata.image.thumbnailUrl;
        } else if (point.metadata.image?.url) {
          imageUrl = point.metadata.image.url;
        }
        
        if (!imageUrl) return;
        
        newVisibleImages.add(imageUrl);
        
        // Only load if not already cached and under limit
        if (!imageCache.current.has(imageUrl) && imagesToLoad < MAX_IMAGES) {
          imagesToLoad++;
          const img = new Image();
          // Don't set crossOrigin to avoid CORS issues with Met images
          // This means we can't read pixel data from the images, but we can still draw them
          img.onload = () => {
            imageCache.current.set(imageUrl, img);
            // Trigger redraw when image loads
            setRedrawTrigger(prev => prev + 1);
          };
          img.onerror = () => {
            // Don't log errors for now as many Met images might 404
            // console.error('Failed to load image:', imageUrl);
          };
          img.src = imageUrl;
        }
      });
      
      // Clean up images that are no longer visible (keep a buffer)
      if (imageCache.current.size > MAX_IMAGES * 2) {
        const imagesToRemove: string[] = [];
        imageCache.current.forEach((img, url) => {
          if (!newVisibleImages.has(url)) {
            imagesToRemove.push(url);
          }
        });
        
        // Remove oldest images first
        imagesToRemove.slice(0, Math.max(0, imageCache.current.size - MAX_IMAGES * 1.5)).forEach(url => {
          imageCache.current.delete(url);
        });
      }
      
      visibleImages.current = newVisibleImages;
      console.log(`Loading ${imagesToLoad} new images, ${newVisibleImages.size} visible, ${imageCache.current.size} cached`);
    }, 200), // 200ms debounce
    [setRedrawTrigger]
  );
  
  // Preload images when in thumbnail mode
  useEffect(() => {
    if (displayMode !== 'thumbnails') return;
    
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    
    loadVisibleImages(data, transform, canvas);
  }, [data, displayMode, transform, loadVisibleImages]);
  
  // Draw canvas function
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    // Apply d3-zoom transformations
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    
    // Create color scale
    const colorScale = createColorScale(data, colorBy);
    
    // Sort points by relevance (draw less relevant first), but always draw highlighted last
    const sortedData = [...data].sort((a, b) => {
      // Always draw highlighted point last
      if (highlightedArtworkId === a.artwork_id) return 1;
      if (highlightedArtworkId === b.artwork_id) return -1;
      
      const scoreA = searchResultsMap.get(a.artwork_id) || 0;
      const scoreB = searchResultsMap.get(b.artwork_id) || 0;
      return scoreA - scoreB;
    });
    
    // Draw points
    sortedData.forEach(point => {
      const x = ((point.normalizedCoords?.[0] || 0) - 0.5) * rect.width * 0.8;
      const y = ((point.normalizedCoords?.[1] || 0) - 0.5) * rect.height * 0.8;
      
      // Calculate opacity based on search results
      let alpha = 0.8;
      let basePointSize = 3;
      
      if (searchResults.length > 0) {
        const score = searchResultsMap.get(point.artwork_id);
        if (score !== undefined) {
          // Find the rank of this result (1-based)
          const rank = searchResults.findIndex(r => r.id === point.artwork_id) + 1;
          const normalizedRank = rank / searchResults.length; // 0 to 1, where 0 is best
          
          // Opacity: top results are fully opaque, bottom results more transparent
          // Range: 0.2 to 1.0 (broader range than before)
          alpha = 1.0 - (normalizedRank * 0.8);
          
          // Size: top results are larger, with smooth scaling
          // Range: 2 to 6 pixels
          basePointSize = 6 - (normalizedRank * 4);
        } else {
          // Not in search results - very faint and small
          alpha = 0.1;
          basePointSize = 2;
        }
      }
      
      // Scale point size partially with zoom
      // Using square root gives a nice balance - points grow but at a slower rate than zoom
      // At scale 1: pointSize = basePointSize
      // At scale 4: pointSize = basePointSize * 2  
      // At scale 16: pointSize = basePointSize * 4
      const pointSize = basePointSize * Math.sqrt(transform.k) / transform.k;
      
      // Check if this point is highlighted
      const isHighlighted = highlightedArtworkId === point.artwork_id;
      
      if (displayMode === 'thumbnails') {
        // Draw thumbnail
        // Get image URL from the image field
        let imageUrl = '';
        if (typeof point.metadata.image === 'string') {
          imageUrl = point.metadata.image;
        } else if (point.metadata.image?.thumbnailUrl) {
          imageUrl = point.metadata.image.thumbnailUrl;
        } else if (point.metadata.image?.url) {
          imageUrl = point.metadata.image.url;
        }
        const img = imageUrl ? imageCache.current.get(imageUrl) : null;
        
        // Calculate thumbnail size based on zoom
        const baseThumbnailSize = 20;
        // Cap the size at high zoom levels to prevent excessive overlap
        const maxThumbnailSize = 30; // Maximum size in screen pixels
        const calculatedSize = baseThumbnailSize * Math.sqrt(transform.k) / transform.k;
        const thumbnailSize = Math.min(calculatedSize, maxThumbnailSize);
        
        if (img && img.complete) {
          ctx.globalAlpha = alpha;
          
          // Draw image centered at point
          ctx.drawImage(
            img,
            x - thumbnailSize / 2,
            y - thumbnailSize / 2,
            thumbnailSize,
            thumbnailSize
          );
          
          // Draw border
          if (isHighlighted) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 3 * Math.sqrt(transform.k) / transform.k;
            ctx.globalAlpha = 1;
            ctx.strokeRect(
              x - thumbnailSize / 2,
              y - thumbnailSize / 2,
              thumbnailSize,
              thumbnailSize
            );
          } else {
            // Subtle border for all thumbnails
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1 * Math.sqrt(transform.k) / transform.k;
            ctx.strokeRect(
              x - thumbnailSize / 2,
              y - thumbnailSize / 2,
              thumbnailSize,
              thumbnailSize
            );
          }
        } else {
          // Fallback to colored square if no image
          ctx.fillStyle = getPointColor(point, colorBy, colorScale);
          ctx.globalAlpha = alpha;
          ctx.fillRect(
            x - thumbnailSize / 2,
            y - thumbnailSize / 2,
            thumbnailSize,
            thumbnailSize
          );
        }
      } else {
        // Draw point (original mode)
        ctx.fillStyle = getPointColor(point, colorBy, colorScale);
        ctx.globalAlpha = alpha;
        
        ctx.beginPath();
        ctx.arc(x, y, pointSize, 0, 2 * Math.PI);
        ctx.fill();
        
        // Draw highlight ring if this is the highlighted artwork
        if (isHighlighted) {
          ctx.strokeStyle = '#ff0000'; // Red highlight
          ctx.lineWidth = 2 * Math.sqrt(transform.k) / transform.k; // Use same scaling as points
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x, y, pointSize + (4 * Math.sqrt(transform.k) / transform.k), 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    });
    
    ctx.restore();
  }, [data, colorBy, searchResults, searchResultsMap, createColorScale, getPointColor, highlightedArtworkId, transform, displayMode]);
  
  // Draw canvas on data or transform changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, transform, redrawTrigger]);
  
  
  if (loading) {
    return (
      <Card className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </Card>
    );
  }
  
  return (
    <div ref={containerRef} className="relative h-full overflow-hidden" style={{ touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${
          hoveredPoint ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
      />
      
      {/* Reset zoom button */}
      {(() => {
        const defaultTransform = getDefaultTransform();
        return (
          Math.abs(transform.k - 1.2) > 0.01 || 
          Math.abs(transform.x - defaultTransform.x) > 1 || 
          Math.abs(transform.y - defaultTransform.y) > 1
        );
      })() && (
        <button
          onClick={resetZoom}
          className="absolute top-4 right-4 px-3 py-1 bg-background/80 backdrop-blur-sm border rounded-md text-sm hover:bg-background/90 transition-colors"
        >
          Reset Zoom
        </button>
      )}
      
      
      {/* Tooltip */}
      {hoveredPoint && (
        <ArtworkTooltip point={hoveredPoint} mousePos={mousePos} />
      )}
    </div>
  );
}