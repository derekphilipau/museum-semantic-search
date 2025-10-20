import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Museum Semantic Search",
  description:
    "Explore the artwork collections using semantic search powered by Jina text and Jina CLIP image embeddings",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased">
        <Navbar />
        <main className="bg-background">
          {children}
        </main>
        <Analytics />
      </body>
    </html>
  );
}
