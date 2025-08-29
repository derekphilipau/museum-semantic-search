import MultiModelSearch from './components/MultiModelSearch';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="py-8">
        <h1 className="text-3xl font-bold text-center mb-2">
          Met Museum Artwork Explorer
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Compare multimodal AI models for artwork search
        </p>
        
        <MultiModelSearch />
      </div>
    </main>
  );
}
