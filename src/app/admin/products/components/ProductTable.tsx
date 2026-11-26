"use client";

import React, { useState, useCallback } from "react";
import DeleteConfirmModal from "@/components/admin/DeleteConfirmModal";
import Link from "next/link";
import { Edit2, Trash2, Package, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-helper";
import { copyText } from "@/lib/clipboard";
import { getProductStockSummary } from "@/lib/inventory";
import { Product } from "../types";

interface ProductTableProps {
  products: Product[];
  currencySymbol?: string;
  onDeleted: () => void;
}

export default function ProductTable({
  products,
  currencySymbol = "৳",
  onDeleted,
}: ProductTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;

    setDeletingId(id);
    try {
      const res = await authenticatedFetch(`/api/products/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (res.ok && result?.success) {
        toast.success(`"${name}" deleted`);
        setDeleteTarget(null);
        onDeleted();
      } else {
        toast.error(result?.error ?? "Failed to delete");
      }
    } catch {
      toast.error("Network error. Please try again.");
    }
    setDeletingId(null);
  }, [deleteTarget, onDeleted]);

  const handleCopyUrl = async (id: string) => {
    const url = `${window.location.origin}/shop/${id}`;
    const ok = await copyText(url);
    if (ok) toast.success("Product link copied");
    else toast.error("Could not copy link");
  };

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200/80 py-16 px-4 text-center">
        <Package size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-800">No physical products found</p>
        <p className="text-xs text-gray-400 mt-1">
          Click &quot;Add Product&quot; to create a physical product listing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full min-w-0">
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Product?"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        isDeleting={!!deletingId}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
      />

      {/* ── Desktop Non-Clipping CSS Grid ── */}
      <div className="hidden md:block bg-white rounded-2xl border border-gray-200/80 overflow-hidden w-full">
        <div className="grid grid-cols-[minmax(0,2fr)_130px_110px_84px_108px] xl:grid-cols-[minmax(0,2.4fr)_160px_130px_100px_116px] items-center gap-3 px-4 py-3 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500">
          <div>Product</div>
          <div>Category</div>
          <div>Price</div>
          <div>Stock</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="divide-y divide-gray-100">
          {products.map((product) => {
            const activePrice = product.salePrice ?? product.regularPrice ?? product.price ?? 0;
            const isDeleting = deletingId === product.id;

            return (
              <div
                key={product.id}
                className={cn(
                  "grid grid-cols-[minmax(0,2fr)_130px_110px_84px_108px] xl:grid-cols-[minmax(0,2.4fr)_160px_130px_100px_116px] items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors",
                  isDeleting && "opacity-40 pointer-events-none"
                )}
              >
                {/* Product */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 bg-gray-50 rounded-xl shrink-0 flex items-center justify-center border border-gray-100 overflow-hidden">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-contain p-1"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={18} className="text-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{product.name}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">
                      {product.description || "No description"}
                    </p>
                  </div>
                </div>

                {/* Category */}
                <div className="min-w-0">
                  <span className="inline-block max-w-full truncate px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">
                    {product.category || "—"}
                  </span>
                </div>

                {/* Price */}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 tabular-nums truncate">
                    {currencySymbol}
                    {activePrice.toFixed(2)}
                  </p>
                  {product.salePrice && (
                    <p className="text-[11px] text-gray-400 line-through tabular-nums truncate">
                      {currencySymbol}
                      {(product.regularPrice ?? 0).toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Stock (Clicks straight to Inventory) */}
                <div className="min-w-0">
                  {(() => {
                    const summary = getProductStockSummary(product as any);
                    return (
                      <Link
                        href={`/admin/inventory?q=${encodeURIComponent(product.name)}`}
                        title="Manage stock in Inventory"
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums hover:underline",
                          summary.status === "out_of_stock"
                            ? "bg-red-50 text-red-600"
                            : summary.status === "low_stock"
                            ? "bg-amber-50 text-amber-700"
                            : summary.status === "unlimited"
                            ? "text-gray-500"
                            : "text-emerald-700"
                        )}
                      >
                        {summary.status === "out_of_stock"
                          ? "Out"
                          : summary.status === "unlimited"
                          ? "Unlimited"
                          : summary.count}
                      </Link>
                    );
                  })()}
                </div>

                {/* Actions (Fixed width — never clips) */}
                <div className="flex items-center justify-end gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(product.id)}
                    className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-black hover:bg-gray-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    title="Copy product link"
                  >
                    <Copy size={14} />
                  </button>
                  <Link
                    href={`/admin/products/${product.id}/edit`}
                    className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-black hover:bg-gray-50 flex items-center justify-center transition-colors shrink-0"
                    title="Edit product"
                  >
                    <Edit2 size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ id: product.id, name: product.name })}
                    disabled={isDeleting}
                    className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                    title="Delete product"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mobile Card View (< md) ── */}
      <div className="md:hidden space-y-3">
        {products.map((product) => {
          const activePrice = product.salePrice ?? product.regularPrice ?? product.price ?? 0;
          const isDeleting = deletingId === product.id;

          return (
            <div
              key={product.id}
              className={cn(
                "bg-white rounded-2xl border border-gray-200/80 p-4 space-y-3",
                isDeleting && "opacity-40 pointer-events-none"
              )}
            >
              <div className="flex gap-3">
                <div className="w-14 h-14 bg-gray-50 rounded-xl shrink-0 flex items-center justify-center border border-gray-100 overflow-hidden">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <Package size={20} className="text-gray-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 line-clamp-1">{product.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{product.category || "—"}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-sm font-bold text-gray-900 tabular-nums">
                      {currencySymbol}
                      {activePrice.toFixed(2)}
                    </span>
                    {(() => {
                      const summary = getProductStockSummary(product as any);
                      return (
                        <Link
                          href={`/admin/inventory?q=${encodeURIComponent(product.name)}`}
                          className={cn(
                            "text-xs font-semibold hover:underline",
                            summary.status === "out_of_stock"
                              ? "text-red-600"
                              : summary.status === "low_stock"
                              ? "text-amber-700"
                              : summary.status === "unlimited"
                              ? "text-gray-400"
                              : "text-emerald-700"
                          )}
                        >
                          {summary.label}
                        </Link>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2.5 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => handleCopyUrl(product.id)}
                  className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:text-black flex items-center justify-center cursor-pointer shrink-0"
                  title="Copy link"
                >
                  <Copy size={14} />
                </button>
                <Link
                  href={`/admin/products/${product.id}/edit`}
                  className="flex-1 h-9 rounded-lg border border-gray-200 text-gray-900 font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-gray-50"
                >
                  <Edit2 size={13} /> Edit
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ id: product.id, name: product.name })}
                  disabled={isDeleting}
                  className="w-9 h-9 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
