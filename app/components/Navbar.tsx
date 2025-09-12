'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Github, Search, ChartScatter } from 'lucide-react';

// Configure GitHub repository URL - update this with your actual repository
const GITHUB_REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || 'https://github.com/yourusername/museum-semantic-search-next';

export default function Navbar() {
  const pathname = usePathname();
  const handleGitHubClick = () => {
    window.open(GITHUB_REPO_URL, '_blank');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Left side - Title and navigation */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex flex-col">
              <h1 className="text-lg font-bold">Museum Semantic Search</h1>
              <p className="text-xs text-muted-foreground">
                Explore art through AI-powered visual and textual similarity
              </p>
            </Link>
            
            {/* Navigation links */}
            <nav className="flex items-center gap-2 sm:gap-4">
              <Link href="/">
                <Button
                  variant={pathname === '/' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1 sm:gap-2 px-2 sm:px-4"
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">Search</span>
                </Button>
              </Link>
              <Link href="/explore">
                <Button
                  variant={pathname === '/explore' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1 sm:gap-2 px-2 sm:px-4"
                >
                  <ChartScatter className="h-4 w-4" />
                  <span className="hidden sm:inline">Visualize</span>
                </Button>
              </Link>
            </nav>
          </div>
          
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