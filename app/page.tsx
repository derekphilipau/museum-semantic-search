import MultiModelSearch from './components/MultiModelSearch';

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <div className="py-6 px-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Met Museum Artwork Explorer
          </h1>
          <p className="text-base text-muted-foreground max-w-3xl mx-auto">
            Search the Metropolitan Museum&apos;s collection using state-of-the-art multimodal AI models. 
            Compare semantic search results across different embedding technologies.
          </p>
        </div>
        
        <MultiModelSearch />
      </div>
    </main>
  );
}