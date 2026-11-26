"use client";

import React, { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  X,
  Package,
  Zap,
  Plus,
  Boxes,
  Infinity as InfinityIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-helper";
import { useRealtime } from "@/lib/realtime-client";
import ManageStockModal from "@/components/admin/ManageStockModal";
import {
  getProductStockSummary,
  hasPerVariantStock,
  resolveVirtualStockMode,
  type StockableProduct,
} from "@/lib/inventory";

type KindFilter = "all" | "physical" | "virtual";
type StatusFilter = "all" | "low_stock" | "out_of_stock" | "unlimited";

const VIRTUAL_LABELS: Record<string, string> = {
  social: "Social Growth",
  account: "Account",
  license: "License Key",
  software: "Software",
};

function InventoryContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [products, setProducts] = useState<(StockableProduct & Record<string, any>)[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState(initialQuery);
  const [activeProduct, setActiveProduct] = useState<
    (StockableProduct & Record<string, any>) | null
  >(null);

  useEffect(() => {
    const urlQ = searchParams.get("q");
    if (urlQ !== null) setQuery(urlQ);
  }, [searchParams]);

  const fetchInventory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authenticatedFetch("/api/products", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      if (!silent) toast.error("Failed to load inventory");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory(false);
  }, [fetchInventory]);

  useRealtime("products", () => fetchInventory(true));

  const kindFiltered = useMemo(() => {
    return products.filter((p) => {
      const isVirt = p.productKind === "virtual";
      if (kindFilter === "physical") return !isVirt;
      if (kindFilter === "virtual") return isVirt;
      return true;
    });
  }, [products, kindFilter]);

  const counts = useMemo(() => {
    let low = 0;
    let out = 0;
    let unlim = 0;
    for (const p of kindFiltered) {
      const sum = getProductStockSummary(p);
      if (sum.status === "low_stock") low++;
      else if (sum.status === "out_of_stock") out++;
      else if (sum.status === "unlimited") unlim++;
    }
    return { all: kindFiltered.length, low_stock: low, out_of_stock: out, unlimited: unlim };
  }, [kindFiltered]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return kindFiltered.filter((p) => {
      const sum = getProductStockSummary(p);
      if (statusFilter !== "all" && sum.status !== statusFilter) return false;

      if (!q) return true;
      const inVariants = Array.isArray(p.variants)
        ? p.variants.some((v) => v.name?.toLowerCase().includes(q))
        : false;
      return (
        p.name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        inVariants
      );
    });
  }, [kindFiltered, statusFilter, query]);

  return (
    <div className="w-full min-w-0 space-y-4 pb-12">
      {/* Top Bar: Kind Tabs + Status Filter Pills */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Kind Switcher */}
        <div className="inline-flex items-center gap-1 bg-white p-1.5 rounded-2xl border border-gray-200/80 self-start">
          {(
            [
              { id: "all", label: "All Products" },
              { id: "physical", label: "Physical" },
              { id: "virtual", label: "Virtual" },
            ] as { id: KindFilter; label: string }[]
          ).map((t) => {
            const active = kindFilter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setKindFilter(t.id)}
                className={cn(
                  "h-8 px-3.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer",
                  active
                    ? "bg-black text-white"
                    : "text-gray-600 hover:text-gray-950 hover:bg-gray-100/70"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              { id: "all", label: "All", count: counts.all },
              { id: "out_of_stock", label: "Out of Stock", count: counts.out_of_stock },
              { id: "low_stock", label: "Low Stock", count: counts.low_stock },
              { id: "unlimited", label: "Unlimited", count: counts.unlimited },
            ] as { id: StatusFilter; label: string; count: number }[]
          ).map((pill) => {
            const active = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                className={cn(
                  "h-8 px-3 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer shrink-0",
                  active
                    ? "bg-gray-950 text-white border-gray-950"
                    : "bg-white text-gray-600 border-gray-200/80 hover:border-gray-300 hover:text-gray-900"
                )}
              >
                <span>{pill.label}</span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tabular-nums",
                    active
                      ? "bg-white/20 text-white"
                      : pill.id === "out_of_stock" && pill.count > 0
                      ? "bg-red-50 text-red-600"
                      : pill.id === "low_stock" && pill.count > 0
                      ? "bg-amber-50 text-amber-700"
                      : "bg-gray-100 text-gray-500"
                  )}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-3 flex items-center justify-between gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inventory by product, category, or variant…"
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
        <span className="hidden sm:inline text-xs font-medium text-gray-400 px-2 shrink-0">
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Inventory Table / List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6 space-y-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 py-16 px-4 text-center">
          <Boxes size={30} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-gray-800">No matching inventory items</p>
          <p className="text-xs text-gray-400 mt-1">
            Try switching filters or clearing your search query.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Non-Clipping CSS Grid */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200/80 overflow-hidden w-full">
            <div className="grid grid-cols-[minmax(0,2fr)_130px_150px_136px] xl:grid-cols-[minmax(0,2.4fr)_160px_180px_148px] items-center gap-3 px-4 py-3 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500">
              <div>Product</div>
              <div>Type</div>
              <div>Current Stock</div>
              <div className="text-right">Action</div>
            </div>

            <div className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const isVirt = p.productKind === "virtual";
                const summary = getProductStockSummary(p);
                const perVar = hasPerVariantStock(p);
                const virtMode = isVirt ? resolveVirtualStockMode(p) : null;

                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-[minmax(0,2fr)_130px_150px_136px] xl:grid-cols-[minmax(0,2.4fr)_160px_180px_148px] items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors"
                  >
                    {/* Product + Variant Breakdown */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.name}
                            className="w-full h-full object-contain p-1"
                          />
                        ) : isVirt ? (
                          <Zap size={17} className="text-gray-300" />
                        ) : (
                          <Package size={17} className="text-gray-300" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                        {perVar && Array.isArray(p.variants) ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.variants.map((v) => {
                              const vs = Number(v.stock) || 0;
                              return (
                                <span
                                  key={v.id || v.name}
                                  className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                    vs <= 0
                                      ? "bg-red-50 text-red-600"
                                      : vs <= 5
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-gray-100 text-gray-700"
                                  )}
                                >
                                  {v.name}: {vs <= 0 ? "Out" : vs}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {p.category || "Uncategorized"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Type */}
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 max-w-full truncate px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">
                        {isVirt ? (
                          <>
                            <Zap size={11} className="shrink-0" />
                            <span className="truncate">
                              {VIRTUAL_LABELS[String(p.virtualType || "social")]}
                            </span>
                          </>
                        ) : (
                          <>
                            <Package size={11} className="shrink-0" />
                            <span className="truncate">Physical</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Stock Badge */}
                    <div className="min-w-0">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border tabular-nums",
                          summary.status === "out_of_stock"
                            ? "bg-red-50 text-red-600 border-red-200"
                            : summary.status === "low_stock"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : summary.status === "unlimited"
                            ? "bg-gray-100 text-gray-700 border-gray-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        )}
                      >
                        {summary.status === "unlimited" && <InfinityIcon size={12} />}
                        {summary.label}
                      </span>
                      {isVirt && virtMode === "pool" && (
                        <span className="block text-[10px] text-gray-400 mt-0.5">
                          Auto-pool stock
                        </span>
                      )}
                    </div>

                    {/* Action */}
                    <div className="flex justify-end shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveProduct(p)}
                        className={cn(
                          "h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer",
                          summary.status === "out_of_stock"
                            ? "bg-black hover:bg-gray-800 text-white"
                            : "border border-gray-200 bg-white hover:bg-gray-50 text-gray-900"
                        )}
                      >
                        <Plus size={13} />
                        {summary.status === "out_of_stock" ? "Add Stock" : "Manage"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((p) => {
              const isVirt = p.productKind === "virtual";
              const summary = getProductStockSummary(p);
              const perVar = hasPerVariantStock(p);

              return (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl border border-gray-200/80 p-4 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.name}
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        <Package size={18} className="text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {isVirt
                          ? VIRTUAL_LABELS[String(p.virtualType || "social")]
                          : "Physical"}{" "}
                        · {p.category || "—"}
                      </p>
                    </div>
                  </div>

                  {perVar && Array.isArray(p.variants) && (
                    <div className="flex flex-wrap gap-1">
                      {p.variants.map((v) => {
                        const vs = Number(v.stock) || 0;
                        return (
                          <span
                            key={v.id || v.name}
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] font-medium",
                              vs <= 0
                                ? "bg-red-50 text-red-600"
                                : "bg-gray-100 text-gray-700"
                            )}
                          >
                            {v.name}: {vs <= 0 ? "Out" : vs}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border tabular-nums",
                        summary.status === "out_of_stock"
                          ? "bg-red-50 text-red-600 border-red-200"
                          : summary.status === "low_stock"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : summary.status === "unlimited"
                          ? "bg-gray-100 text-gray-700 border-gray-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      )}
                    >
                      {summary.label}
                    </span>

                    <button
                      type="button"
                      onClick={() => setActiveProduct(p)}
                      className="h-8 px-3.5 rounded-lg bg-black text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus size={13} /> Manage Stock
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ManageStockModal
        product={activeProduct}
        isOpen={Boolean(activeProduct)}
        onClose={() => setActiveProduct(null)}
        onSaved={(updated) => {
          if (updated?.id) {
            setProducts((prev) =>
              prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
            );
          } else {
            fetchInventory(true);
          }
        }}
      />
    </div>
  );
}

export default function AdminInventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6 space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl" />
          ))}
        </div>
      }
    >
      <InventoryContent />
    </Suspense>
  );
}
