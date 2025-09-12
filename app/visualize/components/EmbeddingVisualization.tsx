'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ProjectionPoint, ProjectionType, EmbeddingType, ColorByOption } from '@/app/types';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import * as d3 from 'd3';
import { ArtworkTooltip } from './ArtworkTooltipPortal';

interface SearchResult {
  id: string;
  score: number;
}

interface EmbeddingVisualizationProps {
  embeddingType: EmbeddingType;
  projectionType: ProjectionType;
  colorBy: ColorByOption;
  searchResults?: SearchResult[];
  maxScore?: number;
  onDataLoaded?: (count: number) => void;
}

export function EmbeddingVisualization({
  embeddingType,
  projectionType,
  colorBy,
  searchResults = [],
  maxScore = 1,
  onDataLoaded
}: EmbeddingVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ProjectionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<ProjectionPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  // Canvas state
  const [scale, setScale] = useState(1.2);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  
  // Reset zoom function
  const resetZoom = useCallback(() => {
    setScale(1.2);
    setOffset({ x: 0, y: 0 });
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
  const animationRef = useRef<number | undefined>(undefined);
  
  // Zoom to search results
  useEffect(() => {
    if (searchResults.length === 0 || data.length === 0 || canvasSize.width === 0) return;
    
    // Check if search results have actually changed
    const searchChanged = searchResults.length !== prevSearchResultsRef.current.length ||
      searchResults.some((r, i) => r.id !== prevSearchResultsRef.current[i]?.id);
    
    if (!searchChanged) return;
    
    // Cancel any ongoing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    
    // Update previous search results
    prevSearchResultsRef.current = searchResults;
    
    // Find bounds of search results
    const resultPoints = data.filter(point => searchResultsMap.has(point.artwork_id));
    if (resultPoints.length === 0) return;
    
    const xCoords = resultPoints.map(p => ((p as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[0] - 0.5) * canvasSize.width * 0.8);
    const yCoords = resultPoints.map(p => ((p as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[1] - 0.5) * canvasSize.height * 0.8);
    
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
    const targetOffset = {
      x: -centerX * targetScale,
      y: -centerY * targetScale
    };
    
    // Capture current values at animation start
    const currentScale = scale;
    const currentOffset = { ...offset };
    
    // Animate to new position
    const animationDuration = 500;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / animationDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic
      
      const newScale = currentScale + (targetScale - currentScale) * eased;
      const newOffset = {
        x: currentOffset.x + (targetOffset.x - currentOffset.x) * eased,
        y: currentOffset.y + (targetOffset.y - currentOffset.y) * eased
      };
      
      setScale(newScale);
      setOffset(newOffset);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = undefined;
      }
    };
    
    animate();
    
    // Cleanup animation on unmount
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults, data, canvasSize.width, canvasSize.height, searchResultsMap]); // Removed scale and offset from dependencies

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
  
  // Draw canvas
  useEffect(() => {
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
    
    // Apply transformations
    ctx.save();
    ctx.translate(offset.x + rect.width / 2, offset.y + rect.height / 2);
    ctx.scale(scale, scale);
    
    // Create color scale
    const colorScale = createColorScale(data, colorBy);
    
    // Sort points by relevance (draw less relevant first)
    const sortedData = [...data].sort((a, b) => {
      const scoreA = searchResultsMap.get(a.artwork_id) || 0;
      const scoreB = searchResultsMap.get(b.artwork_id) || 0;
      return scoreA - scoreB;
    });
    
    // Draw points
    sortedData.forEach(point => {
      const x = ((point as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[0] - 0.5) * rect.width * 0.8;
      const y = ((point as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[1] - 0.5) * rect.height * 0.8;
      
      // Calculate opacity based on search results
      let alpha = 0.8;
      let pointSize = 3;
      
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
          pointSize = 6 - (normalizedRank * 4);
        } else {
          // Not in search results - very faint and small
          alpha = 0.1;
          pointSize = 1.5;
        }
      }
      
      // Get color
      ctx.fillStyle = getPointColor(point, colorBy, colorScale);
      ctx.globalAlpha = alpha;
      
      // Draw point
      ctx.beginPath();
      ctx.arc(x, y, pointSize, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    ctx.restore();
  }, [data, scale, offset, colorBy, searchResults, searchResultsMap, maxScore, createColorScale, getPointColor]);
  
  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
    
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    } else {
      // Check for hover
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - offset.x - rect.width / 2) / scale;
      const y = (e.clientY - rect.top - offset.y - rect.height / 2) / scale;
      
      // Find all points within hover radius, accounting for zoom
      const hoverRadius = Math.max(5 / scale, 2); // Adjust radius based on zoom
      const candidates: Array<{point: ProjectionPoint, dist: number, score: number}> = [];
      
      for (const point of data) {
        const px = ((point as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[0] - 0.5) * rect.width * 0.8;
        const py = ((point as ProjectionPoint & {normalizedCoords: number[]}).normalizedCoords[1] - 0.5) * rect.height * 0.8;
        const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
        
        if (dist < hoverRadius) {
          const score = searchResultsMap.get(point.artwork_id) || 0;
          candidates.push({ point, dist, score });
        }
      }
      
      if (candidates.length > 0) {
        // Sort by: 1) search relevance (higher first), 2) distance (closer first)
        candidates.sort((a, b) => {
          if (searchResults.length > 0 && a.score !== b.score) {
            return b.score - a.score; // Higher scores first
          }
          return a.dist - b.dist; // Closer points first
        });
        setHoveredPoint(candidates[0].point);
      } else {
        setHoveredPoint(null);
      }
    }
  }, [isDragging, dragStart, data, scale, offset, searchResults.length, searchResultsMap]);
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    
    // Calculate minimum zoom to fit content in viewport
    const effectiveMinScale = 1.2;
    
    // Get mouse position relative to canvas
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate new scale
    const newScale = Math.max(effectiveMinScale, Math.min(50, scale * delta));
    
    // Adjust offset to zoom towards mouse position
    // The mouse position in world coordinates should remain the same after zoom
    // worldX = (mouseX - offset.x - rect.width/2) / scale
    // After zoom: worldX = (mouseX - newOffset.x - rect.width/2) / newScale
    // Solving for newOffset.x:
    // newOffset.x = mouseX - rect.width/2 - worldX * newScale
    const worldX = (mouseX - offset.x - rect.width / 2) / scale;
    const worldY = (mouseY - offset.y - rect.height / 2) / scale;
    
    const newOffsetX = mouseX - rect.width / 2 - worldX * newScale;
    const newOffsetY = mouseY - rect.height / 2 - worldY * newScale;
    
    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }, [scale, offset]);
  
  if (loading) {
    return (
      <Card className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </Card>
    );
  }
  
  return (
    <div ref={containerRef} className="relative h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      
      {/* Reset zoom button */}
      {(Math.abs(scale - 1.2) > 0.01 || Math.abs(offset.x) > 1 || Math.abs(offset.y) > 1) && (
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