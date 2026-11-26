// Server Component — no "use client" directive.
// This allows Next.js to SSR the page shell and bake the
// hero image URL into the initial HTML, so the browser can
// start fetching it immediately (before JS runs) → lower LCP.

export const dynamic = "force-dynamic";

import React from "react";
import { storage } from "@/lib/storage";
import HeroSlider from "@/components/HeroSlider";
import HomeNavWrapper from "@/components/HomeNavWrapper";
import ProductGrid from "@/components/ProductGrid";
import Footer from "@/components/Footer";

export default async function Home() {
  // Fetch settings server-side. Next.js deduplicates this with the
  // layout.tsx call in the same request.
  let banners: any[] = [];
  try {
    const settings = await storage.getSettings();
    banners = (settings as any)?.banners ?? [];
  } catch {
    banners = [];
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      {/* Semantic H1 for search engines & accessibility */}
      <h1 className="sr-only">
        Afra Tech Point - Best Online Tech & Gadget Shop in Bangladesh
      </h1>

      {/* Navigation Bar — full width edge-to-edge */}
      <HomeNavWrapper />

      {/* Hero Slider — full width edge-to-edge banner */}
      {banners.length > 0 && (
        <section className="w-full">
          <HeroSlider banners={banners} />
        </section>
      )}

      {/* Full Catalog Section */}
      <section className="w-full mt-4 md:mt-8">
        <ProductGrid />
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
