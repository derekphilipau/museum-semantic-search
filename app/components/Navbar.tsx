'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';

// Configure GitHub repository URL - update this with your actual repository
const GITHUB_REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || 'https://github.com/yourusername/museum-semantic-search-next';

export default function Navbar() {
  const handleGitHubClick = () => {
    window.open(GITHUB_REPO_URL, '_blank');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Left side - Title and byline */}
          <Link href="/" className="flex flex-col">
            <h1 className="text-lg font-bold">Museum Semantic Search</h1>
            <p className="text-xs text-muted-foreground">
              Explore art through AI-powered visual and textual similarity
            </p>
          </Link>
          
          {/* Right side - GitHub button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleGitHubClick}
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">View on GitHub</span>
          </Button>
        </div>
      </div>
    </header>
  );
}