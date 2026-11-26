"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Image as ImageIcon, Plus, Trash2, X,
  Link2, UserRound, KeyRound, Download, Boxes
} from "lucide-react";
import { toast } from "sonner";
import MediaPickerModal from "@/components/admin/MediaPickerModal";
import AdminSelect from "@/components/admin/AdminSelect";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-helper";
import type { VirtualType, VirtualConfig, VirtualCustomField } from "@/types/product";

interface Variant {
  id: string;
  name: string;
  regularPrice: number;
  stock?: number | null;
}

interface VirtualProduct {
  id: string;
  name: string;
  image: string;
  gallery?: string[];
  category: string;
  aboutItem?: string;
  description: string;
  regularPrice: number;
  salePrice?: number;
  tags?: string[];
  variants?: any[];
  virtualType?: VirtualType;
  virtualConfig?: VirtualConfig;
}

const INPUT =
  "w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 min-w-0";
const TEXTAREA =
  "w-full p-3.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 resize-y leading-relaxed min-w-0";

function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6">
      {title && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Label({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <label className="text-xs font-semibold text-gray-700">{children}</label>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
  );
}

export default function VirtualProductForm({ initialData }: { initialData?: VirtualProduct | null }) {
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [virtualType, setVirtualType] = useState<VirtualType>(initialData?.virtualType || "social");
  const [name, setName] = useState(initialData?.name || "");
  const [image, setImage] = useState(initialData?.image || "");
  const [gallery, setGallery] = useState<string[]>(initialData?.gallery || []);
  const [category, setCategory] = useState(initialData?.category || "");
  const [aboutItem, setAboutItem] = useState(initialData?.aboutItem || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [variants, setVariants] = useState<Variant[]>(
    Array.isArray(initialData?.variants)
      ? initialData!.variants!.map((v: any) => ({
          id: v.id || Date.now().toString(),
          name: v.name,
          regularPrice: v.regularPrice || 0,
          stock: v.stock,
        }))
      : []
  );
  const [newVariantName, setNewVariantName] = useState("");
  const [newVariantPrice, setNewVariantPrice] = useState("");

  const [downloadUrl, setDownloadUrl] = useState(initialData?.virtualConfig?.downloadUrl || "");
  const [version, setVersion] = useState(initialData?.virtualConfig?.version || "");
  const [fileSize, setFileSize] = useState(initialData?.virtualConfig?.fileSize || "");
  const [customFields, setCustomFields] = useState<VirtualCustomField[]>(
    initialData?.virtualConfig?.customFields || []
  );

  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [pickingFor, setPickingFor] = useState<"main" | "gallery">("main");
  const [availableCategories, setAvailableCategories] = useState<any[]>([]);

  useEffect(() => {
    authenticatedFetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.categories) setAvailableCategories(data.categories);
      });
  }, []);

  const categoryOptions = React.useMemo(() => {
    if (availableCategories.length > 0) {
      return availableCategories.map((cat) => {
        const label = String(cat.label || cat);
        return { value: label, label };
      });
    }
    return [{ value: "Virtual", label: "Virtual" }];
  }, [availableCategories]);

  const addTag = (raw: string) => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^\w\u0980-\u09FF\s_-]/g, "")
      .replace(/\s+/g, "-");
    if (cleaned && !tags.includes(cleaned)) setTags((prev) => [...prev, cleaned]);
    setTagInput("");
  };

  const handleAddVariant = () => {
    if (!newVariantName.trim()) return;
    setVariants([
      ...variants,
      {
        id: Date.now().toString(),
        name: newVariantName.trim(),
        regularPrice: parseFloat(newVariantPrice) || 0,
      },
    ]);
    setNewVariantName("");
    setNewVariantPrice("");
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { id: `cf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: "", placeholder: "" },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a product name");
      return;
    }
    if (!category) {
      toast.error("Please select a category");
      return;
    }
    if (!image) {
      toast.error("Please select a main product image");
      return;
    }
    if (virtualType === "software" && !downloadUrl.trim()) {
      toast.error("Enter the external download URL");
      return;
    }

    const existingCfg = initialData?.virtualConfig || {};
    const virtualConfig: VirtualConfig = {
      ...existingCfg,
      downloadUrl: virtualType === "software" ? downloadUrl.trim() : undefined,
      version: virtualType === "software" ? version.trim() : undefined,
      fileSize: virtualType === "software" ? fileSize.trim() : undefined,
      customFields:
        virtualType === "social"
          ? customFields
              .filter((f) => f.label.trim())
              .map((f) => ({
                id: f.id,
                label: f.label.trim(),
                placeholder: f.placeholder.trim(),
              }))
          : undefined,
    };

    setIsSubmitting(true);
    const method = initialData ? "PUT" : "POST";
    const url = initialData ? `/api/products/${initialData.id}` : "/api/products";
    try {
      const res = await authenticatedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          image,
          gallery,
          category,
          aboutItem,
          description,
          regularPrice: variants[0]?.regularPrice || 0,
          salePrice: undefined,
          tags,
          variants,
          productKind: "virtual",
          virtualType,
          virtualConfig,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.push("/admin/virtual-products");
      router.refresh();
    } catch (err) {
      console.error("Failed to save virtual product", err);
      setIsSubmitting(false);
    }
  };

  const types = [
    { id: "social" as VirtualType, label: "Social Growth", desc: "Page or profile URL", icon: Link2 },
    { id: "account" as VirtualType, label: "Account Provide", desc: "Login ID & password", icon: UserRound },
    { id: "license" as VirtualType, label: "License Key", desc: "Auto key delivery", icon: KeyRound },
    { id: "software" as VirtualType, label: "Software / ZIP", desc: "Direct download link", icon: Download },
  ];

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0 pb-12 space-y-5">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/virtual-products"
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={15} />
          Back to Virtual Products
        </Link>

        <div className="flex items-center gap-2.5">
          {initialData?.id && (
            <Link
              href={`/admin/inventory?q=${encodeURIComponent(initialData.name)}`}
              className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-800 inline-flex items-center gap-1.5 transition-colors"
            >
              <Boxes size={14} /> Manage Stock
            </Link>
          )}
          <Link
            href="/admin/virtual-products"
            className="h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center justify-center transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-9 px-4 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span>{isSubmitting ? "Saving…" : initialData ? "Save Changes" : "Save Product"}</span>
          </button>
        </div>
      </div>

      {/* Product Type Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {types.map((t) => {
          const Icon = t.icon;
          const active = virtualType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setVirtualType(t.id)}
              className={cn(
                "flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer min-w-0",
                active
                  ? "bg-gray-950 border-gray-950 text-white shadow-sm"
                  : "bg-white border-gray-200/80 text-gray-700 hover:border-gray-300"
              )}
            >
              <span
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                  active ? "bg-white/15 text-white" : "bg-gray-100 text-gray-500"
                )}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className={cn("block text-xs font-bold truncate", active ? "text-white" : "text-gray-900")}>
                  {t.label}
                </span>
                <span className={cn("block text-[11px] truncate", active ? "text-gray-300" : "text-gray-400")}>
                  {t.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Stock & Pool Notice for Account / License Types */}
      {(virtualType === "license" || virtualType === "account") && (
        <div className="bg-white rounded-2xl border border-gray-200/80 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-gray-600">
            <Boxes size={15} className="text-gray-500 shrink-0" />
            <span>
              {virtualType === "license"
                ? "License keys and stock availability are managed in the dedicated Inventory section."
                : "Pre-stocked accounts and stock limits are managed in the dedicated Inventory section."}
            </span>
          </div>
          {initialData?.id && (
            <Link
              href={`/admin/inventory?q=${encodeURIComponent(initialData.name)}`}
              className="text-xs font-semibold text-gray-950 underline shrink-0"
            >
              Open in Inventory →
            </Link>
          )}
        </div>
      )}

      {/* Software Download Info (Software Type Only) */}
      {virtualType === "software" && (
        <Card title="Software Download">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <Label hint="Google Drive or direct link">Download URL</Label>
              <input
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://…"
                className={INPUT}
              />
            </div>
            <div>
              <Label>Version</Label>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. v1.0"
                className={INPUT}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>File Size</Label>
              <input
                value={fileSize}
                onChange={(e) => setFileSize(e.target.value)}
                placeholder="e.g. 24 MB"
                className={INPUT}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Basic Details + Category + Tags */}
      <Card title="Product Details">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Label>Product Name</Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Facebook Followers – 1000"
                className={INPUT}
              />
            </div>
            <div>
              <Label>Category</Label>
              <AdminSelect
                value={category}
                onChange={setCategory}
                options={categoryOptions}
                placeholder="Select category"
              />
            </div>
          </div>

          <div>
            <Label hint="Optional">Short Summary</Label>
            <textarea
              value={aboutItem}
              onChange={(e) => setAboutItem(e.target.value)}
              rows={2}
              placeholder="Short highlight shown below product title…"
              className={TEXTAREA}
            />
          </div>

          <div>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              placeholder="Write full product or service details…"
              className={TEXTAREA}
            />
          </div>

          <div>
            <Label hint="Press Enter or comma to add">Tags</Label>
            <div
              className="min-h-[42px] flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-gray-200 hover:border-gray-300 focus-within:border-black focus-within:ring-2 focus-within:ring-black/5 transition-all cursor-text"
              onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}
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
                    className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
                    setTags((t) => t.slice(0, -1));
                  }
                }}
                onBlur={() => tagInput.trim() && addTag(tagInput)}
                placeholder={tags.length === 0 ? "e.g. facebook, followers, social…" : ""}
                className="bg-transparent outline-none text-sm text-gray-900 placeholder:text-gray-400 flex-1 min-w-[140px]"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Media */}
      <Card
        title="Media"
        action={
          <button
            type="button"
            onClick={() => {
              setPickingFor("gallery");
              setIsMediaPickerOpen(true);
            }}
            className="h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus size={13} /> Add Gallery
          </button>
        }
      >
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div
            onClick={() => {
              setPickingFor("main");
              setIsMediaPickerOpen(true);
            }}
            className="relative w-full sm:w-36 h-36 rounded-xl bg-gray-50 border border-dashed border-gray-300 hover:border-gray-900 cursor-pointer transition-colors overflow-hidden flex items-center justify-center shrink-0 group"
          >
            {image ? (
              <img src={image} alt="Main" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-gray-400 group-hover:text-gray-700 transition-colors">
                <ImageIcon size={22} />
                <span className="text-[11px] font-medium">Select Cover</span>
              </div>
            )}
            <span className="absolute top-2 left-2 bg-black/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">
              Cover
            </span>
          </div>

          <div className="flex-1 w-full min-w-0">
            {gallery.length > 0 ? (
              <div className="flex flex-wrap gap-2.5">
                {gallery.map((g, i) => (
                  <div
                    key={i}
                    className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 group"
                  >
                    <img src={g} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setGallery(gallery.filter((_, idx) => idx !== i))}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X size={15} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-36 border border-dashed border-gray-200 rounded-xl flex items-center justify-center text-xs text-gray-400">
                No gallery images added
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Product Variants */}
      <Card title="Product Variants">
        <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
          <input
            value={newVariantName}
            onChange={(e) => setNewVariantName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddVariant();
              }
            }}
            placeholder="Variant name (e.g. 1K Followers)"
            className={cn(INPUT, "flex-1")}
          />
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              value={newVariantPrice}
              onChange={(e) => setNewVariantPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddVariant();
                }
              }}
              placeholder="Price"
              className={cn(INPUT, "flex-1 sm:w-32 font-semibold")}
            />
            <button
              type="button"
              onClick={handleAddVariant}
              className="h-10 px-4 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        {variants.length === 0 ? (
          <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-xl">
            No variants added yet.
          </p>
        ) : (
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={v.id} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                  value={v.name}
                  onChange={(e) => {
                    const u = [...variants];
                    u[i].name = e.target.value;
                    setVariants(u);
                  }}
                  placeholder="Variant name"
                  className={cn(INPUT, "flex-1")}
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    value={v.regularPrice || ""}
                    onChange={(e) => {
                      const u = [...variants];
                      u[i].regularPrice = parseFloat(e.target.value) || 0;
                      setVariants(u);
                    }}
                    placeholder="Price"
                    className={cn(INPUT, "flex-1 sm:w-32 font-semibold")}
                  />
                  <button
                    type="button"
                    onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                    className="w-10 h-10 rounded-xl border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                    aria-label="Remove variant"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Custom Fields — Below Product Variants (Social Growth Only) */}
      {virtualType === "social" && (
        <Card
          title={`Custom Fields (${customFields.length})`}
          action={
            <button
              type="button"
              onClick={addCustomField}
              className="h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={13} /> Add Field
            </button>
          }
        >
          {customFields.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-xl">
              No custom fields added. Add fields to collect buyer URLs or usernames at checkout.
            </p>
          ) : (
            <div className="space-y-2.5">
              {customFields.map((f, i) => (
                <div key={f.id} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                  <div className="flex-1 min-w-0">
                    {i === 0 && <Label>Field Label</Label>}
                    <input
                      value={f.label}
                      onChange={(e) => {
                        const n = [...customFields];
                        n[i].label = e.target.value;
                        setCustomFields(n);
                      }}
                      placeholder="e.g. Page / Profile URL"
                      className={INPUT}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    {i === 0 && <Label>Placeholder</Label>}
                    <input
                      value={f.placeholder}
                      onChange={(e) => {
                        const n = [...customFields];
                        n[i].placeholder = e.target.value;
                        setCustomFields(n);
                      }}
                      placeholder="e.g. https://facebook.com/..."
                      className={INPUT}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomFields(customFields.filter((_, idx) => idx !== i))}
                    className="h-10 px-3 sm:w-10 sm:px-0 rounded-xl border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                    aria-label="Remove field"
                  >
                    <Trash2 size={14} />
                    <span className="sm:hidden text-xs font-medium">Remove</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Bottom Save Bar */}
      <div className="flex items-center justify-end gap-2.5 pt-2">
        <Link
          href="/admin/virtual-products"
          className="h-10 px-5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center justify-center transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-10 px-6 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          <span>{isSubmitting ? "Saving…" : initialData ? "Save Changes" : "Create Virtual Product"}</span>
        </button>
      </div>

      <MediaPickerModal
        isOpen={isMediaPickerOpen}
        multiSelect={pickingFor === "gallery"}
        onClose={() => {
          setIsMediaPickerOpen(false);
          setPickingFor("main");
        }}
        onSelect={(url) => {
          if (pickingFor === "main") setImage(url);
          else setGallery((prev) => [...prev, url]);
          setIsMediaPickerOpen(false);
        }}
        onSelectMultiple={(urls) => {
          if (pickingFor === "gallery")
            setGallery((prev) => {
              const s = new Set(prev);
              return [...prev, ...urls.filter((u) => !s.has(u))];
            });
          setIsMediaPickerOpen(false);
        }}
      />
    </form>
  );
}
