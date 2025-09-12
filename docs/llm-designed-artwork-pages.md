# LLM-Designed Artwork Pages Feature

## Overview
Transform static artwork display pages into dynamically themed experiences where an AI analyzes each artwork and generates a custom page design that complements the piece's mood, palette, and artistic style.

## Core Concept
Instead of generating visual assets (frames), the AI acts as a UI/UX designer, outputting a structured configuration object that controls:
- Color schemes
- Typography
- Layout properties
- Component styling
- Micro-interactions and animations

## Implementation Plan

### 1. Define the Design Vocabulary

Create a constrained set of design tokens that the AI can select from:

```typescript
interface ArtworkThemeConfig {
  palette: {
    background: 'bg-slate-50' | 'bg-slate-900' | 'bg-stone-100' | 'bg-stone-950' | 'bg-white' | 'bg-neutral-50' | 'bg-zinc-900';
    text: 'text-slate-900' | 'text-slate-200' | 'text-stone-800' | 'text-stone-300' | 'text-neutral-900';
    accent: 'text-sky-500' | 'text-amber-500' | 'text-emerald-500' | 'text-rose-500' | 'text-indigo-500' | 'text-orange-500';
    border: 'border-slate-200' | 'border-slate-800' | 'border-transparent' | 'border-stone-300';
    surface: 'bg-white/5' | 'bg-black/5' | 'bg-white/10' | 'bg-black/10'; // For overlays
  };
  typography: {
    font: 'font-sans' | 'font-serif' | 'font-mono';
    titleSize: 'text-3xl' | 'text-4xl' | 'text-5xl' | 'text-6xl';
    bodySize: 'text-base' | 'text-lg' | 'text-sm';
    letterSpacing: 'tracking-normal' | 'tracking-wide' | 'tracking-wider';
  };
  layout: {
    contentWidth: 'max-w-4xl' | 'max-w-5xl' | 'max-w-6xl' | 'max-w-7xl' | 'max-w-full';
    artworkPadding: 'p-0' | 'p-2' | 'p-4' | 'p-8' | 'p-12';
    spacing: 'space-y-4' | 'space-y-6' | 'space-y-8' | 'space-y-12';
  };
  containerStyle: {
    shadow: 'shadow-none' | 'shadow-sm' | 'shadow-lg' | 'shadow-2xl';
    rounding: 'rounded-none' | 'rounded-lg' | 'rounded-2xl' | 'rounded-3xl';
    border: 'border-0' | 'border' | 'border-2';
  };
  effects: {
    blur: 'backdrop-blur-none' | 'backdrop-blur-sm' | 'backdrop-blur';
    opacity: 'opacity-90' | 'opacity-95' | 'opacity-100';
    transition: 'transition-none' | 'transition-all' | 'transition-colors';
    duration: 'duration-150' | 'duration-300' | 'duration-500';
  };
  mood: {
    intensity: 'subtle' | 'moderate' | 'bold' | 'dramatic';
    temperature: 'cool' | 'neutral' | 'warm';
    energy: 'calm' | 'balanced' | 'dynamic';
  };
  rationale: string;
}
```

### 2. Enhanced Prompt Engineering

Develop a sophisticated prompt that considers multiple artwork attributes:

```
You are an expert UI/UX designer specializing in creating thematic digital experiences for art galleries. Analyze the provided artwork and generate a JSON configuration for a webpage that enhances the viewing experience.

Consider:
- Color palette and dominant hues
- Artistic movement and historical period
- Emotional tone and mood
- Subject matter and themes
- Composition and visual weight
- Cultural context

Select values ONLY from the provided options. Your design should:
1. Complement without competing with the artwork
2. Create an appropriate viewing atmosphere
3. Enhance readability of metadata
4. Respect the artwork's cultural significance

[Include full JSON schema with options]
```

### 3. Implementation Architecture

#### a. Theme Generation Service
```typescript
// lib/themes/generate-artwork-theme.ts
export async function generateArtworkTheme(artwork: {
  imageUrl: string;
  title: string;
  artist: string;
  period?: string;
  description?: string;
  tags?: string[];
}): Promise<ArtworkThemeConfig> {
  // Call Gemini API with artwork data
  // Parse and validate response
  // Return theme configuration
}
```

#### b. Theme Caching Strategy
- Store generated themes in `data/met/artwork_themes.jsonl`
- Include artwork ID for quick lookups
- Enable batch generation for existing artworks
- Implement cache invalidation for updates

#### c. React Components

```typescript
// components/artwork/ThemedArtworkPage.tsx
export function ThemedArtworkPage({ 
  artwork, 
  theme 
}: { 
  artwork: Artwork; 
  theme: ArtworkThemeConfig;
}) {
  const { palette, typography, layout, containerStyle, effects } = theme;
  
  return (
    <div className={cn(
      'min-h-screen transition-colors duration-700',
      palette.background,
      palette.text,
      typography.font
    )}>
      {/* Implement themed layout */}
    </div>
  );
}
```

#### d. Fallback Themes
Create preset themes for common artwork categories:
- Classical/Renaissance: Light, serif fonts, generous spacing
- Modern/Abstract: Bold contrasts, sans-serif, minimal
- Photography: Neutral tones, focus on the image
- Sculpture: Dimensional shadows, stone-inspired colors

### 4. Advanced Features

#### a. Responsive Theme Variations
Generate mobile-specific adjustments:
- Simplified layouts for smaller screens
- Touch-friendly spacing
- Optimized typography scales

#### b. Theme Transitions
Smooth animations when navigating between artworks:
- Color morphing
- Layout transitions
- Progressive enhancement

#### c. Accessibility Modes
- High contrast variations
- Reduced motion options
- WCAG-compliant color combinations

#### d. User Preferences
- Remember preferred intensity levels
- Dark/light mode overrides
- Font size adjustments

### 5. Development Steps

1. **Setup Phase**
   - Create theme type definitions
   - Set up theme generation endpoint
   - Design fallback themes

2. **Generation Pipeline**
   - Write script to generate themes for existing artworks
   - Implement caching mechanism
   - Add retry logic for API failures

3. **Frontend Implementation**
   - Build ThemedArtworkPage component
   - Create theme provider/context
   - Implement smooth transitions

4. **Testing & Refinement**
   - A/B test different theme vocabularies
   - Gather user feedback
   - Refine prompt based on results

5. **Performance Optimization**
   - Pre-generate themes during data pipeline
   - Implement efficient theme switching
   - Optimize for Core Web Vitals

6. **Monitoring & Analytics**
   - Track theme performance
   - Monitor user engagement metrics
   - Identify most effective combinations

### 6. Example Theme Generation Script

```typescript
// scripts/met/generate-artwork-themes.ts
import { generateArtworkTheme } from '../../lib/themes/generate-artwork-theme';
import { readArtworksFromJSONL, writeThemeToJSONL } from '../../lib/utils';

async function generateThemes() {
  const artworks = await readArtworksFromJSONL('data/met/artworks.jsonl');
  const existingThemes = await readExistingThemeIds('data/met/artwork_themes.jsonl');
  
  for (const artwork of artworks) {
    if (existingThemes.has(artwork.id)) {
      console.log(`Theme already exists for ${artwork.id}, skipping...`);
      continue;
    }
    
    try {
      const theme = await generateArtworkTheme({
        imageUrl: artwork.primaryImageUrl,
        title: artwork.title,
        artist: artwork.artistDisplayName,
        period: artwork.period,
        description: artwork.description,
        tags: artwork.tags
      });
      
      await writeThemeToJSONL({
        artworkId: artwork.id,
        theme,
        generatedAt: new Date().toISOString()
      });
      
      console.log(`Generated theme for ${artwork.title}`);
    } catch (error) {
      console.error(`Failed to generate theme for ${artwork.id}:`, error);
    }
  }
}
```

### 7. Success Metrics

- **User Engagement**: Time spent on artwork pages
- **Theme Effectiveness**: Bounce rate reduction
- **Performance**: Page load times with dynamic themes
- **Accessibility**: Compliance scores
- **User Satisfaction**: Feedback and ratings

### 8. Future Enhancements

1. **Multi-artwork Galleries**: Cohesive themes for collections
2. **Seasonal Variations**: Holiday-appropriate themes
3. **Artist-specific Themes**: Consistent styling for artist pages
4. **Interactive Elements**: Hover effects, parallax, micro-animations
5. **Social Sharing**: Theme-aware Open Graph images
6. **Print Styles**: Optimized themes for printing