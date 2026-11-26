"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useSettings } from "@/components/SettingsProvider";
import ProductTable from "./components/ProductTable";
import { Product } from "./types";
import { authenticatedFetch } from "@/lib/api-helper";
import { useRealtime } from "@/lib/realtime-client";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const settings = useSettings();

  const fetchProducts = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await authenticatedFetch("/api/products", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data)) {
        // Keep Physical Products separate from Virtual Products
        const physicalOnly = data.filter(
          (p: Product) => (p.productKind || "physical") !== "virtual"
        );
        setProducts(physicalOnly);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts(false);
  }, [fetchProducts]);

  useRealtime("products", () => fetchProducts(true));

  useEffect(() => {
    const q = query.toLowerCase().trim();
    if (!q) {
      setFiltered(products);
    } else {
      setFiltered(
        products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.category?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q)
        )
      );
    }
  }, [query, products]);

  return (
    <div className="space-y-4 w-full min-w-0 pb-10">
      {/* ── Single-Row Toolbar ── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search physical products by name or category…"
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-gray-50 border border-gray-200/80 focus:bg-white focus:border-black outline-none text-sm text-gray-900 placeholder:text-gray-400 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <span className="text-xs font-medium text-gray-400 whitespace-nowrap px-1">
            {filtered.length} of {products.length}
          </span>

          <Link
            href="/admin/products/new"
            className="h-10 px-4 rounded-xl bg-black hover:bg-gray-800 text-white font-semibold text-xs sm:text-sm inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Plus size={16} />
            <span>Add Product</span>
          </Link>
        </div>
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="w-11 h-11 bg-gray-100 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-100 rounded-full w-1/3" />
                <div className="h-2.5 bg-gray-100 rounded-full w-1/2" />
              </div>
              <div className="h-3 bg-gray-100 rounded-full w-16" />
            </div>
          ))}
        </div>
      ) : (
        <ProductTable
          products={filtered}
          currencySymbol={settings?.currencySymbol ?? "৳"}
          onDeleted={() => fetchProducts(true)}
        />
      )}
    </div>
  );
}
