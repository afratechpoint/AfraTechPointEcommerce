"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Zap, Trash2, Edit2, Package, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/components/SettingsProvider";
import { authenticatedFetch } from "@/lib/api-helper";
import DeleteConfirmModal from "@/components/admin/DeleteConfirmModal";
import type { VirtualConfig, VirtualType } from "@/types/product";
import { useRealtime } from "@/lib/realtime-client";
import { copyText } from "@/lib/clipboard";
import { getProductStockSummary } from "@/lib/inventory";
import { cn } from "@/lib/utils";

interface VirtualProduct {
  id: string;
  name: string;
  category: string;
  regularPrice: number;
  salePrice?: number;
  stock?: number | null;
  image?: string;
  productKind?: string;
  virtualType?: VirtualType;
  virtualConfig?: VirtualConfig;
  variants?: { name: string; regularPrice?: number; salePrice?: number; stock?: number | null }[];
}

const TYPE_LABEL: Record<VirtualType, string> = {
  social: "Social Growth",
  account: "Account",
  license: "License Key",
  software: "Software",
};

export default function VirtualProductsPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "৳";
  const [products, setProducts] = useState<VirtualProduct[]>([]);
  const [filtered, setFiltered] = useState<VirtualProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<VirtualProduct | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authenticatedFetch("/api/products", { cache: "no-store" });
      const data = await res.json();
      const virtual = (Array.isArray(data) ? data : []).filter(
        (p: any) => p.productKind === "virtual"
      );
      setProducts(virtual);
    } catch {
      if (!silent) toast.error("Failed to load virtual products.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts(false);
  }, [fetchProducts]);

  useRealtime("products", () => fetchProducts(true));

  useEffect(() => {
    const q = query.toLowerCase().trim();
    setFiltered(
      q
        ? products.filter(
            (p) =>
              p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
          )
        : products
    );
  }, [query, products]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await authenticatedFetch(`/api/products/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Virtual product deleted");
      setDeleteTarget(null);
      fetchProducts(true);
    } catch {
      toast.error("Failed to delete product");
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyUrl = async (id: string) => {
    const ok = await copyText(`${window.location.origin}/shop/${id}`);
    if (ok) toast.success("Product link copied");
    else toast.error("Could not copy link");
  };

  return (
    <div className="space-y-4 w-full min-w-0 pb-10">
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Virtual Product?"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        isDeleting={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />

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
            placeholder="Search virtual products by name or category…"
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
            href="/admin/virtual-products/new"
            className="h-10 px-4 rounded-xl bg-black hover:bg-gray-800 text-white font-semibold text-xs sm:text-sm inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Plus size={16} /> Add Virtual Product
          </Link>
        </div>
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6 space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 py-16 px-4 text-center">
          <Zap size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-gray-800">No virtual products found</p>
          <p className="text-xs text-gray-400 mt-1">
            Click &quot;Add Virtual Product&quot; to list accounts, keys, social growth, or software.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Non-Clipping CSS Grid */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200/80 overflow-hidden w-full">
            <div className="grid grid-cols-[minmax(0,2fr)_116px_110px_96px_108px] xl:grid-cols-[minmax(0,2.4fr)_136px_130px_116px_116px] items-center gap-3 px-4 py-3 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500">
              <div>Product</div>
              <div>Type</div>
              <div>Price</div>
              <div>Stock</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const price = p.salePrice ?? p.regularPrice ?? 0;
                const stockSummary = getProductStockSummary(p as any);
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-[minmax(0,2fr)_116px_110px_96px_108px] xl:grid-cols-[minmax(0,2.4fr)_136px_130px_116px_116px] items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                        {p.image ? (
                          <img src={p.image} alt={p.name} className="w-full h-full object-contain p-1" />
                        ) : (
                          <Package size={18} className="text-gray-300" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {p.category || "—"}
                          {p.variants && p.variants.length > 0
                            ? ` · ${p.variants.length} var`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <span className="inline-block max-w-full truncate px-2.5 py-1 bg-gray-100 text-gray-800 rounded-lg text-xs font-medium">
                        {TYPE_LABEL[p.virtualType || "social"]}
                      </span>
                    </div>

                    <div className="min-w-0 text-sm font-bold text-gray-900 tabular-nums truncate">
                      {currency}
                      {price.toFixed(2)}
                    </div>

                    <div className="min-w-0">
                      <Link
                        href={`/admin/inventory?q=${encodeURIComponent(p.name)}`}
                        title="Manage stock in Inventory"
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold truncate max-w-full hover:underline",
                          stockSummary.status === "out_of_stock"
                            ? "bg-red-50 text-red-600"
                            : stockSummary.status === "low_stock"
                            ? "bg-amber-50 text-amber-700"
                            : stockSummary.status === "unlimited"
                            ? "text-gray-500"
                            : "text-emerald-700"
                        )}
                      >
                        {stockSummary.status === "out_of_stock" ? "Out" : stockSummary.label}
                      </Link>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(p.id)}
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-black hover:bg-gray-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Copy link"
                      >
                        <Copy size={14} />
                      </button>
                      <Link
                        href={`/admin/virtual-products/${p.id}/edit`}
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-black hover:bg-gray-50 flex items-center justify-center transition-colors shrink-0"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-gray-200/80 p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <Package size={18} className="text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {TYPE_LABEL[p.virtualType || "social"]} · {p.category || "—"}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">
                    {currency}
                    {(p.salePrice ?? p.regularPrice ?? 0).toFixed(2)}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-2.5 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(p.id)}
                    className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 flex items-center justify-center cursor-pointer"
                  >
                    <Copy size={14} />
                  </button>
                  <Link
                    href={`/admin/virtual-products/${p.id}/edit`}
                    className="flex-1 h-9 rounded-lg border border-gray-200 text-xs font-semibold text-gray-900 flex items-center justify-center gap-1.5"
                  >
                    <Edit2 size={13} /> Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(p)}
                    className="w-9 h-9 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
