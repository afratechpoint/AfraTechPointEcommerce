"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Loader2,
  Image as ImageIcon,
  Plus,
  Trash2,
  X,
  ExternalLink,
  Check,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/components/SettingsProvider";
import MediaPickerModal from "@/components/admin/MediaPickerModal";
import AdminSelect from "@/components/admin/AdminSelect";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-helper";
import { getProductStockSummary } from "@/lib/inventory";

interface Variant {
  id: string;
  name: string;
  regularPrice?: number;
  salePrice?: number;
  image?: string;
  useMainPrice?: boolean;
  stock?: number | null;
}

interface Product {
  id: string;
  name: string;
  regularPrice: number;
  salePrice?: number;
  price?: number;
  category: string;
  image: string;
  gallery?: string[];
  aboutItem?: string;
  description: string;
  specifications?: { label: string; value: string }[];
  variants?: Variant[];
  stock?: number;
  tags?: string[];
}

interface ProductFormProps {
  initialData?: Product | null;
}

const INPUT =
  "w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 min-w-0";

const TEXTAREA =
  "w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 resize-y leading-relaxed min-w-0";

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-950 truncate">{title}</h2>
          {description && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Label({
  children,
  hint,
  required,
}: {
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <label className="text-xs font-medium text-gray-700">
        {children}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
  );
}

export default function ProductForm({ initialData }: ProductFormProps) {
  const router = useRouter();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "৳";

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Controlled fields
  const [name, setName] = useState(initialData?.name || "");
  const [aboutItem, setAboutItem] = useState(initialData?.aboutItem || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [image, setImage] = useState(initialData?.image || "");
  const [gallery, setGallery] = useState<string[]>(
    Array.isArray(initialData?.gallery) ? initialData!.gallery! : []
  );
  const [availableCategories, setAvailableCategories] = useState<any[]>([]);
  const [category, setCategory] = useState(initialData?.category || "");

  const [regularPrice, setRegularPrice] = useState<string>(
    initialData?.regularPrice !== undefined
      ? String(initialData.regularPrice)
      : initialData?.price !== undefined
      ? String(initialData.price)
      : ""
  );
  const [salePrice, setSalePrice] = useState<string>(
    initialData?.salePrice !== undefined && initialData.salePrice > 0
      ? String(initialData.salePrice)
      : ""
  );

  const [variants, setVariants] = useState<Variant[]>(
    Array.isArray(initialData?.variants) ? initialData!.variants! : []
  );
  const [newVariantName, setNewVariantName] = useState("");

  const [specs, setSpecs] = useState<{ label: string; value: string }[]>(
    Array.isArray(initialData?.specifications) ? initialData!.specifications! : []
  );
  const [tags, setTags] = useState<string[]>(
    Array.isArray(initialData?.tags) ? initialData!.tags! : []
  );
  const [tagInput, setTagInput] = useState("");

  // Media Picker Modal
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [pickingFor, setPickingFor] = useState<"main" | "gallery" | number>("main");

  const numericRegular = parseFloat(regularPrice) || 0;
  const numericSale = salePrice !== "" ? parseFloat(salePrice) : undefined;

  const discount =
    numericSale !== undefined && numericSale > 0 && numericRegular > numericSale
      ? Math.round(((numericRegular - numericSale) / numericRegular) * 100)
      : 0;

  // Keep variants that inherit main price synced
  useEffect(() => {
    setVariants((prev) =>
      prev.map((v) =>
        v.useMainPrice
          ? { ...v, regularPrice: numericRegular, salePrice: numericSale }
          : v
      )
    );
  }, [numericRegular, numericSale]);

  useEffect(() => {
    authenticatedFetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.categories)) {
          setAvailableCategories(data.categories);
        }
      })
      .catch(() => {});
  }, []);

  const categoryOptions = useMemo(() => {
    const opts =
      availableCategories.length > 0
        ? availableCategories.map((cat) => {
            const label = String(cat.label || cat);
            return { value: label, label };
          })
        : [{ value: "General", label: "General" }];

    if (category && !opts.some((o) => o.value === category)) {
      return [{ value: category, label: category }, ...opts];
    }
    return opts;
  }, [availableCategories, category]);

  const addTag = (raw: string) => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^\w\u0980-\u09FF\s_-]/g, "")
      .replace(/\s+/g, "-");
    if (cleaned && !tags.includes(cleaned)) {
      setTags((prev) => [...prev, cleaned]);
    }
    setTagInput("");
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const addVariant = () => {
    const trimmed = newVariantName.trim();
    if (!trimmed) return;
    setVariants((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: trimmed,
        useMainPrice: true,
        regularPrice: numericRegular,
        salePrice: numericSale,
      },
    ]);
    setNewVariantName("");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a product name");
      return;
    }
    if (!category) {
      toast.error("Please select a product category");
      return;
    }
    if (!image) {
      toast.error("Please select a main product image");
      return;
    }
    if (numericRegular <= 0) {
      toast.error("Please enter a valid regular price");
      return;
    }

    setIsSubmitting(true);
    const method = initialData ? "PUT" : "POST";
    const url = initialData ? `/api/products/${initialData.id}` : "/api/products";

    const cleanedSpecs = specs
      .map((s) => ({ label: s.label.trim(), value: s.value.trim() }))
      .filter((s) => s.label || s.value);

    try {
      const res = await authenticatedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          aboutItem: aboutItem.trim(),
          description: description.trim(),
          category,
          regularPrice: numericRegular,
          salePrice: numericSale && numericSale > 0 ? numericSale : undefined,
          variants,
          gallery,
          specifications: cleanedSpecs,
          tags,
          image,
          productKind: "physical",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Failed to save product");
      }

      toast.success(initialData ? "Product updated" : "Product created");
      router.push("/admin/products");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to save product");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0 space-y-5 pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-gray-200/80">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin/products"
            title="Back to Products"
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-600 hover:text-gray-950 transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-gray-950 truncate">
                {initialData ? "Edit Product" : "Add Physical Product"}
              </h1>
              {initialData?.id && (
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-mono text-gray-500">
                  #{initialData.id.slice(0, 8)}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate">
              {initialData
                ? name || "Update product details, media, pricing, and stock"
                : "Create a physical storefront item with inventory & variants"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {initialData?.id && (
            <Link
              href={`/shop/${initialData.id}`}
              target="_blank"
              className="h-9 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 inline-flex items-center gap-1.5 transition-colors"
            >
              <ExternalLink size={13} />
              <span className="hidden sm:inline">View in Shop</span>
            </Link>
          )}
          <Link
            href="/admin/products"
            className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 inline-flex items-center justify-center transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-9 px-4 rounded-xl bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            <span>{isSubmitting ? "Saving…" : initialData ? "Save Changes" : "Publish Product"}</span>
          </button>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN (8 cols): Title, Description, Media, Variants, Specifications */}
        <div className="lg:col-span-8 space-y-5 min-w-0">
          {/* Card 1: Product Overview & Copy */}
          <Card
            title="Product Details"
            description="Title, short highlight summary, and full storefront description."
          >
            <div className="space-y-4">
              <div>
                <Label required>Product Name</Label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. JBL Boombox Portable Bluetooth Speaker"
                  className={INPUT}
                />
              </div>

              <div>
                <Label hint="Shown right beneath the price">Short Summary (Optional)</Label>
                <textarea
                  rows={2}
                  value={aboutItem}
                  onChange={(e) => setAboutItem(e.target.value)}
                  placeholder="Key highlight in 1–2 lines (warranty, authenticity, key feature)…"
                  className={TEXTAREA}
                />
              </div>

              <div>
                <Label required>Full Description</Label>
                <textarea
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  placeholder="Detailed product overview, features, compatibility, and package contents…"
                  className={TEXTAREA}
                />
              </div>
            </div>
          </Card>

          {/* Card 2: Product Images */}
          <Card
            title="Product Media"
            description="Primary cover photo and additional gallery angles."
            action={
              <button
                type="button"
                onClick={() => {
                  setPickingFor("gallery");
                  setIsMediaPickerOpen(true);
                }}
                className="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-900 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus size={13} /> Add Gallery
              </button>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-[168px_minmax(0,1fr)] gap-4 items-start">
              {/* Primary Cover Image */}
              <div className="space-y-1.5">
                <div
                  onClick={() => {
                    setPickingFor("main");
                    setIsMediaPickerOpen(true);
                  }}
                  className="relative w-full aspect-square sm:w-[168px] sm:h-[168px] rounded-xl bg-gray-50/70 border border-dashed border-gray-300 hover:border-black cursor-pointer transition-all overflow-hidden group flex items-center justify-center"
                >
                  {image ? (
                    <>
                      <img
                        src={image}
                        alt="Main product"
                        className="w-full h-full object-contain p-2.5"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                        <span className="px-2.5 py-1 rounded-lg bg-white text-[11px] font-semibold text-gray-950">
                          Change Cover
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImage("");
                          }}
                          className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-semibold hover:bg-red-700 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-gray-400 group-hover:text-gray-900 transition-colors">
                      <ImageIcon size={22} />
                      <span className="text-xs font-medium">Select Cover</span>
                    </div>
                  )}
                  <span className="absolute top-2 left-2 bg-black text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">
                    Cover
                  </span>
                </div>
              </div>

              {/* Gallery Grid */}
              <div className="min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">
                    Gallery Photos ({gallery.length})
                  </span>
                  {gallery.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGallery([])}
                      className="text-[11px] font-medium text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {gallery.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2.5">
                    {gallery.map((g, idx) => (
                      <div
                        key={`${g}-${idx}`}
                        className="relative aspect-square rounded-xl bg-gray-50 border border-gray-200/80 overflow-hidden group"
                      >
                        <img
                          src={g}
                          alt={`Gallery ${idx + 1}`}
                          className="w-full h-full object-contain p-1.5"
                        />
                        <button
                          type="button"
                          onClick={() => setGallery(gallery.filter((_, i) => i !== idx))}
                          title="Remove photo"
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/75 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setPickingFor("gallery");
                        setIsMediaPickerOpen(true);
                      }}
                      className="aspect-square rounded-xl border border-dashed border-gray-200 hover:border-gray-400 bg-gray-50/40 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
                    >
                      <Plus size={16} />
                      <span className="text-[10px] font-medium">Add</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPickingFor("gallery");
                      setIsMediaPickerOpen(true);
                    }}
                    className="w-full h-[140px] rounded-xl border border-dashed border-gray-200 hover:border-gray-300 bg-gray-50/40 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                  >
                    <Plus size={18} />
                    <span className="text-xs font-medium">Add extra gallery angles</span>
                    <span className="text-[11px] text-gray-400">Optional</span>
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* Card 3: Variants */}
          <Card
            title={`Product Variants${variants.length > 0 ? ` (${variants.length})` : ""}`}
            description="Optional color, edition, or storage options with custom photos or pricing."
          >
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newVariantName}
                  onChange={(e) => setNewVariantName(e.target.value)}
                  placeholder="e.g. Matte Black, 8GB / 256GB, Official Warranty"
                  className={cn(INPUT, "flex-1")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addVariant();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addVariant}
                  className="h-10 px-4 rounded-xl bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  <Plus size={14} /> Add Variant
                </button>
              </div>

              {variants.length === 0 ? (
                <div className="py-6 text-center border border-dashed border-gray-200 rounded-xl">
                  <p className="text-xs font-medium text-gray-500">
                    Single-version product (no variants)
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {variants.map((v, i) => (
                    <div
                      key={v.id}
                      className="p-3 rounded-xl border border-gray-200/80 bg-gray-50/40 flex flex-col sm:flex-row gap-3 sm:items-center"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPickingFor(i);
                            setIsMediaPickerOpen(true);
                          }}
                          title="Choose variant image"
                          className="w-11 h-11 rounded-xl bg-white border border-gray-200 hover:border-black flex items-center justify-center overflow-hidden shrink-0 transition-colors cursor-pointer"
                        >
                          {v.image ? (
                            <img
                              src={v.image}
                              alt={v.name}
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <ImageIcon size={15} className="text-gray-400" />
                          )}
                        </button>

                        <input
                          type="text"
                          value={v.name}
                          onChange={(e) => {
                            const updated = [...variants];
                            updated[i] = { ...updated[i], name: e.target.value };
                            setVariants(updated);
                          }}
                          placeholder="Variant name"
                          className="flex-1 h-9 px-3 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-semibold text-gray-900 min-w-0"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...variants];
                            const nextUseMain = !v.useMainPrice;
                            updated[i] = {
                              ...updated[i],
                              useMainPrice: nextUseMain,
                              regularPrice: nextUseMain ? numericRegular : updated[i].regularPrice,
                              salePrice: nextUseMain ? numericSale : updated[i].salePrice,
                            };
                            setVariants(updated);
                          }}
                          className={cn(
                            "h-9 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer",
                            v.useMainPrice
                              ? "bg-gray-950 text-white border-gray-950"
                              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                          )}
                        >
                          {v.useMainPrice && <Check size={12} strokeWidth={2.5} />}
                          Same Price
                        </button>

                        {!v.useMainPrice && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Regular"
                              value={v.regularPrice ?? ""}
                              onChange={(e) => {
                                const updated = [...variants];
                                updated[i] = {
                                  ...updated[i],
                                  regularPrice: parseFloat(e.target.value) || undefined,
                                };
                                setVariants(updated);
                              }}
                              className="w-24 h-9 px-2.5 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-semibold text-gray-900 tabular-nums"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Sale"
                              value={v.salePrice ?? ""}
                              onChange={(e) => {
                                const updated = [...variants];
                                updated[i] = {
                                  ...updated[i],
                                  salePrice: parseFloat(e.target.value) || undefined,
                                };
                                setVariants(updated);
                              }}
                              className="w-24 h-9 px-2.5 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-semibold text-emerald-700 tabular-nums"
                            />
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                          title="Remove variant"
                          className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Card 4: Specifications */}
          <Card
            title={`Technical Specifications${specs.length > 0 ? ` (${specs.length})` : ""}`}
            description="Key-value specification table shown on the product page."
            action={
              <button
                type="button"
                onClick={() => setSpecs((prev) => [...prev, { label: "", value: "" }])}
                className="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-900 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus size={13} /> Add Row
              </button>
            }
          >
            {specs.length === 0 ? (
              <div className="py-6 text-center border border-dashed border-gray-200 rounded-xl">
                <p className="text-xs font-medium text-gray-500">No specifications added</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  e.g. Brand → JBL, Battery Life → 24 Hours, Bluetooth → v5.3
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_38px] gap-2.5 px-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <span>Spec Name</span>
                  <span>Value</span>
                  <span className="text-right">Del</span>
                </div>
                {specs.map((s, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_38px] gap-2 items-center p-2.5 sm:p-0 rounded-xl border border-gray-200/70 sm:border-none"
                  >
                    <input
                      type="text"
                      placeholder="e.g. Battery Life"
                      value={s.label}
                      onChange={(e) => {
                        const next = [...specs];
                        next[i] = { ...next[i], label: e.target.value };
                        setSpecs(next);
                      }}
                      className="h-9 px-3 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-semibold text-gray-900"
                    />
                    <input
                      type="text"
                      placeholder="e.g. Up to 24 hours"
                      value={s.value}
                      onChange={(e) => {
                        const next = [...specs];
                        next[i] = { ...next[i], value: e.target.value };
                        setSpecs(next);
                      }}
                      className="h-9 px-3 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs text-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => setSpecs(specs.filter((_, idx) => idx !== i))}
                      className="w-full sm:w-[38px] h-8 sm:h-9 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT SIDEBAR (4 cols): Pricing, Category & Stock, SEO Tags */}
        <div className="lg:col-span-4 space-y-5 min-w-0 lg:sticky lg:top-20">
          {/* Pricing Card */}
          <Card title="Pricing" description="Set regular price and optional promotional price.">
            <div className="space-y-3.5">
              <div>
                <Label required>Regular Price ({currency})</Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={regularPrice}
                    onChange={(e) => setRegularPrice(e.target.value)}
                    placeholder="0.00"
                    className={cn(INPUT, "pl-8 font-semibold tabular-nums")}
                  />
                </div>
              </div>

              <div>
                <Label hint="Optional">Sale Price ({currency})</Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    placeholder="Leave empty if not on sale"
                    className={cn(INPUT, "pl-8 font-semibold tabular-nums")}
                  />
                </div>
              </div>

              {discount > 0 && (
                <div className="px-3.5 py-2.5 rounded-xl bg-gray-950 text-white flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-medium">Customer saves</span>
                  <span className="font-bold">
                    {discount}% OFF ({currency}
                    {(numericRegular - (numericSale || 0)).toLocaleString()})
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Organization & Inventory Shortcut Card */}
          <Card title="Category & Inventory" description="Storefront category and stock link.">
            <div className="space-y-4">
              <div>
                <Label required>Category</Label>
                <AdminSelect
                  name="category"
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions}
                  placeholder="Select category"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                    <Boxes size={13} className="text-gray-500 shrink-0" />
                    {initialData
                      ? getProductStockSummary(initialData as any).label
                      : "Managed in Inventory"}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {initialData
                      ? "Add or update stock from Inventory"
                      : "Save product first, then add stock in Inventory"}
                  </p>
                </div>

                {initialData?.id && (
                  <Link
                    href={`/admin/inventory?q=${encodeURIComponent(initialData.name)}`}
                    className="h-8 px-3 rounded-lg bg-white border border-gray-200 hover:border-black text-xs font-semibold text-gray-900 inline-flex items-center shrink-0 transition-colors"
                  >
                    Stock →
                  </Link>
                )}
              </div>
            </div>
          </Card>

          {/* Search Tags Card */}
          <Card title="Search Tags" description="Keywords for storefront search & related items.">
            <div>
              <Label hint="Enter or comma">Keywords</Label>
              <div
                className="min-h-[80px] flex flex-wrap content-start gap-1.5 p-2.5 bg-white rounded-xl border border-gray-200 hover:border-gray-300 focus-within:border-black focus-within:ring-2 focus-within:ring-black/5 transition-all cursor-text"
                onClick={(e) =>
                  (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()
                }
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-800 text-xs font-medium rounded-lg"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                      className="text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => tagInput.trim() && addTag(tagInput)}
                  placeholder={tags.length === 0 ? "speaker, bluetooth, jbl…" : "Add tag…"}
                  className="bg-transparent outline-none text-xs text-gray-900 placeholder:text-gray-400 min-w-[110px] flex-1 py-1 px-1"
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom Save Bar (Mobile & Long Scroll Convenience) */}
      <div className="flex items-center justify-end gap-2.5 pt-2">
        <Link
          href="/admin/products"
          className="h-10 px-5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 inline-flex items-center justify-center transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-10 px-6 rounded-xl bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
        >
          {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          <span>{isSubmitting ? "Saving…" : initialData ? "Save Changes" : "Publish Product"}</span>
        </button>
      </div>

      {/* Media Picker Modal */}
      <MediaPickerModal
        isOpen={isMediaPickerOpen}
        multiSelect={pickingFor === "gallery"}
        currentUrl={
          pickingFor === "main"
            ? image
            : typeof pickingFor === "number"
            ? variants[pickingFor]?.image
            : undefined
        }
        onClose={() => {
          setIsMediaPickerOpen(false);
          setPickingFor("main");
        }}
        onSelect={(url) => {
          if (pickingFor === "main") {
            setImage(url);
          } else if (pickingFor === "gallery") {
            setGallery((prev) => (prev.includes(url) ? prev : [...prev, url]));
          } else if (typeof pickingFor === "number") {
            setVariants((prev) =>
              prev.map((v, idx) => (idx === pickingFor ? { ...v, image: url } : v))
            );
          }
          setIsMediaPickerOpen(false);
        }}
        onSelectMultiple={(urls) => {
          if (pickingFor === "gallery") {
            setGallery((prev) => {
              const existing = new Set(prev);
              return [...prev, ...urls.filter((u) => !existing.has(u))];
            });
          }
          setIsMediaPickerOpen(false);
        }}
      />
    </form>
  );
}
