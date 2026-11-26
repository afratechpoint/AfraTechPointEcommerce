"use client";

// ── RelatedProducts Component ──────────────────────────────────
// Fetches products in the same category and displays them as
// clickable cards below the main product content.

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Product } from "../types";
import { useRealtime } from "@/lib/realtime-client";
import { isProductOutOfStock } from "@/lib/inventory";

interface RelatedProductsProps {
  currentProductId: string;
  category: string;
  currencySymbol?: string;
}

export default function RelatedProducts({
  currentProductId,
  category,
  currencySymbol = "৳",
}: RelatedProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRelated = useCallback(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((all: Product[]) => {
        if (!Array.isArray(all)) return;
        const related = all
          .filter(
            (p) =>
              p.id !== currentProductId &&
              p.category?.toLowerCase() === category?.toLowerCase()
          )
          .slice(0, 6);
        setProducts(related);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentProductId, category]);

  useEffect(() => {
    fetchRelated();
  }, [fetchRelated]);

  useRealtime("products", fetchRelated);

  // Don't render the section if no related products found
  if (!loading && products.length === 0) return null;

  return (
    <section className="mt-16 md:mt-24">
      <div className="flex items-center gap-4 mb-8">
        <h2 className="text-lg md:text-xl font-bold text-gray-900 uppercase tracking-widest">
          Related Products
        </h2>
        <div className="flex-1 h-px bg-gray-100" />
        <Link
          href={`/shop?category=${encodeURIComponent(category)}`}
          className="text-[9px] font-bold text-gray-400 hover:text-black uppercase tracking-widest transition-all"
        >
          View All →
        </Link>
      </div>

      {loading ? (
        // Skeleton loader
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-square bg-gray-100 rounded-2xl animate-pulse" />
              <div className="h-3 bg-gray-100 rounded-full animate-pulse w-3/4" />
              <div className="h-3 bg-gray-100 rounded-full animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {products.map((p, i) => {
            const price = p.salePrice ?? p.regularPrice ?? p.price ?? 0;
            const outOfStock = isProductOutOfStock(p as any);
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <Link
                  href={`/shop/${p.id}`}
                  className="group block space-y-3"
                >
                  {/* Product image */}
                  <div className="aspect-square bg-gray-100 rounded-2xl overflow-hidden border border-gray-100 relative">
                    {p.image && (
                      <img
                        src={p.image}
                        alt={p.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                    {outOfStock ? (
                      <span className="absolute top-2 left-2 px-2 py-0.5 bg-red-600 text-white rounded text-[8px] font-bold uppercase">
                        Stock Out
                      </span>
                    ) : p.salePrice && p.regularPrice ? (
                      <span className="absolute top-2 left-2 px-2 py-0.5 bg-black text-white rounded text-[7px] font-bold uppercase">
                        {Math.round((1 - p.salePrice / p.regularPrice) * 100)}% OFF
                      </span>
                    ) : null}
                  </div>

                  {/* Name + price */}
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-gray-900 uppercase tracking-tight leading-tight line-clamp-2 group-hover:text-black transition-colors">
                      {p.name}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-black text-black">
                        {currencySymbol}{price.toFixed(2)}
                      </span>
                      {p.salePrice && p.regularPrice && (
                        <span className="text-[9px] text-gray-400 line-through font-medium">
                          {currencySymbol}{p.regularPrice.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}
