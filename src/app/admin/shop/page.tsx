"use client";

import React, { useEffect, useState } from "react";
import {
  Save,
  Loader2,
  Image as ImageIcon,
  Tags,
  Mail,
  Phone,
  MapPin,
  Plus,
  Trash2,
  LayoutTemplate,
  Clock,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import MediaPickerModal from "@/components/admin/MediaPickerModal";
import AdminSelect from "@/components/admin/AdminSelect";
import { authenticatedFetch } from "@/lib/api-helper";

interface BannerItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  linkUrl: string;
}

interface CategoryItem {
  id: string;
  label: string;
  slug: string;
}

const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_OPTIONS = DAYS.map((d) => ({ value: d, label: d }));
const END_DAY_OPTIONS = [{ value: "", label: "Single Day" }, ...DAY_OPTIONS];
const PERIOD_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0980-\u09ff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function AdminShopPage() {
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactAddress, setContactAddress] = useState("");

  // Structured Business Hours State
  const [isEveryday, setIsEveryday] = useState(false);
  const [bhStartDay, setBhStartDay] = useState("Mon");
  const [bhEndDay, setBhEndDay] = useState("Fri");
  const [bhOpenTime, setBhOpenTime] = useState("9:00");
  const [bhOpenPeriod, setBhOpenPeriod] = useState("AM");
  const [bhCloseTime, setBhCloseTime] = useState("6:00");
  const [bhClosePeriod, setBhClosePeriod] = useState("PM");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"banners" | "categories" | "contact">("banners");

  // Media Picker State for Banners
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [activeBannerId, setActiveBannerId] = useState<string | null>(null);

  useEffect(() => {
    authenticatedFetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setBanners(Array.isArray(data.banners) ? data.banners : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setContactEmail(data.contactEmail || "");
        setContactPhone(data.contactPhone || "");
        setContactAddress(data.contactAddress || "");

        if (data.businessHours && typeof data.businessHours === "string") {
          try {
            const parts = data.businessHours.split(": ");
            if (parts.length >= 2) {
              const daysPart = parts[0].trim();
              if (daysPart === "Everyday" || daysPart === "Daily") {
                setIsEveryday(true);
              } else if (daysPart.includes(" - ")) {
                const dayRange = daysPart.split(" - ");
                setBhStartDay(dayRange[0].trim() || "Mon");
                setBhEndDay(dayRange[1]?.trim() || "");
                setIsEveryday(false);
              } else {
                setBhStartDay(daysPart || "Mon");
                setBhEndDay("");
                setIsEveryday(false);
              }

              const times = parts[1].split(" - ");
              if (times.length >= 2) {
                const open = times[0].trim().split(" ");
                const close = times[1].trim().split(" ");
                if (open.length >= 2) {
                  setBhOpenTime(open[0]);
                  setBhOpenPeriod(open[1] === "PM" ? "PM" : "AM");
                }
                if (close.length >= 2) {
                  setBhCloseTime(close[0]);
                  setBhClosePeriod(close[1] === "AM" ? "AM" : "PM");
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse business hours", e);
          }
        }

        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load shop config", err);
        setIsLoading(false);
      });
  }, []);

  const computedBusinessHours = `${
    isEveryday ? "Everyday" : `${bhStartDay}${bhEndDay ? ` - ${bhEndDay}` : ""}`
  }: ${bhOpenTime || "9:00"} ${bhOpenPeriod} - ${bhCloseTime || "6:00"} ${bhClosePeriod}`;

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);

    const cleanedCategories = categories.map((cat) => ({
      ...cat,
      label: (cat.label || "").trim(),
      slug: (cat.slug || "").trim() || toSlug(cat.label || ""),
    }));

    try {
      const res = await authenticatedFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banners,
          categories: cleanedCategories,
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim(),
          contactAddress: contactAddress.trim(),
          businessHours: computedBusinessHours,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setBanners(Array.isArray(updated.banners) ? updated.banners : banners);
        setCategories(Array.isArray(updated.categories) ? updated.categories : cleanedCategories);
        toast.success("Shop configuration saved");
      } else {
        throw new Error("Failed to save");
      }
    } catch {
      toast.error("Failed to save shop configuration");
    } finally {
      setIsSaving(false);
    }
  };

  // Banner Handlers
  const addBanner = () => {
    setBanners((prev) => [
      ...prev,
      { id: Date.now().toString(), title: "", description: "", imageUrl: "", linkUrl: "" },
    ]);
  };

  const updateBanner = (id: string, field: keyof BannerItem, value: string) => {
    setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const moveBanner = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= banners.length) return;
    const next = [...banners];
    [next[index], next[target]] = [next[target], next[index]];
    setBanners(next);
  };

  const removeBanner = (id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  };

  // Category Handlers
  const addCategory = () => {
    setCategories((prev) => [...prev, { id: Date.now().toString(), label: "", slug: "" }]);
  };

  const updateCategoryLabel = (id: string, nextLabel: string) => {
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const prevAutoSlug = toSlug(c.label || "");
        const shouldSyncSlug = !c.slug || c.slug === prevAutoSlug;
        return {
          ...c,
          label: nextLabel,
          slug: shouldSyncSlug ? toSlug(nextLabel) : c.slug,
        };
      })
    );
  };

  const updateCategorySlug = (id: string, nextSlug: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, slug: toSlug(nextSlug) } : c))
    );
  };

  const moveCategory = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
  };

  const removeCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={26} />
      </div>
    );
  }

  const tabs = [
    { id: "banners", label: "Homepage Banners", count: banners.length, icon: LayoutTemplate },
    { id: "categories", label: "Categories", count: categories.length, icon: Tags },
    { id: "contact", label: "Contact & Hours", icon: MapPin },
  ] as const;

  const activeBanner = banners.find((b) => b.id === activeBannerId);

  return (
    <form onSubmit={handleSave} className="w-full min-w-0 space-y-5">
      {/* Top Toolbar: Segmented Tabs + Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-2xl border border-gray-200/80">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-9 px-3.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer",
                  isActive
                    ? "bg-black text-white shadow-xs"
                    : "text-gray-600 hover:text-gray-950 hover:bg-gray-100/80"
                )}
              >
                <Icon size={14} className={isActive ? "text-white" : "text-gray-400"} />
                <span>{tab.label}</span>
                {"count" in tab && typeof tab.count === "number" && (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none",
                      isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shrink-0 cursor-pointer"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {/* TAB 1: HOMEPAGE BANNERS */}
      {activeTab === "banners" && (
        <div className="bg-white rounded-2xl border border-gray-200/80">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-950">Homepage Hero Banners</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Slides displayed in the hero carousel on the storefront homepage.
              </p>
            </div>
            <button
              type="button"
              onClick={addBanner}
              className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            >
              <Plus size={14} /> Add Banner
            </button>
          </div>

          <div className="p-5 space-y-4">
            {banners.length === 0 ? (
              <div className="py-14 text-center border border-dashed border-gray-200 rounded-xl">
                <ImageIcon size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm font-medium text-gray-700">No banners added yet</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-4">
                  Add a slide to showcase featured products or promotions.
                </p>
                <button
                  type="button"
                  onClick={addBanner}
                  className="h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-gray-900 transition-colors cursor-pointer"
                >
                  <Plus size={14} /> Add First Banner
                </button>
              </div>
            ) : (
              banners.map((banner, index) => (
                <div
                  key={banner.id}
                  className="p-4 sm:p-5 rounded-xl border border-gray-200/80 bg-white hover:border-gray-300 transition-colors"
                >
                  {/* Card Top Bar */}
                  <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center h-6 px-2 rounded-md bg-gray-100 text-[11px] font-semibold text-gray-700">
                        Slide {index + 1}
                      </span>
                      {banner.title && (
                        <span className="text-xs text-gray-500 truncate max-w-[220px] sm:max-w-xs">
                          {banner.title}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveBanner(index, "up")}
                        disabled={index === 0}
                        title="Move up"
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:text-black hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBanner(index, "down")}
                        disabled={index === banners.length - 1}
                        title="Move down"
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:text-black hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBanner(banner.id)}
                        title="Remove banner"
                        className="h-7 px-2.5 rounded-lg border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center gap-1 text-xs font-medium transition-colors ml-1 cursor-pointer"
                      >
                        <Trash2 size={13} />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    </div>
                  </div>

                  {/* Banner Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {/* Image Preview */}
                    <div className="lg:col-span-4 space-y-1.5">
                      <label className="block text-xs font-medium text-gray-700">
                        Banner Image
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveBannerId(banner.id);
                          setIsMediaPickerOpen(true);
                        }}
                        className="w-full relative aspect-[16/9] rounded-xl bg-gray-50 border border-dashed border-gray-300 overflow-hidden group cursor-pointer hover:border-black transition-all flex items-center justify-center"
                      >
                        {banner.imageUrl ? (
                          <>
                            <img
                              src={banner.imageUrl}
                              alt={banner.title || `Banner ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="px-3 py-1.5 bg-white rounded-lg text-xs font-semibold text-gray-950 shadow-sm">
                                Change Image
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-gray-400 group-hover:text-gray-900 transition-colors">
                            <ImageIcon size={20} />
                            <span className="text-xs font-medium">Choose from Media</span>
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Text Fields */}
                    <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-gray-700">Headline</label>
                          <span className="text-[11px] text-gray-400 tabular-nums">
                            {(banner.title || "").length}/80
                          </span>
                        </div>
                        <input
                          type="text"
                          value={banner.title || ""}
                          maxLength={80}
                          onChange={(e) => updateBanner(banner.id, "title", e.target.value)}
                          placeholder="e.g. Next-Gen Wireless Audio"
                          className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-700">
                          Button Target URL
                        </label>
                        <input
                          type="text"
                          value={banner.linkUrl || ""}
                          maxLength={160}
                          onChange={(e) => updateBanner(banner.id, "linkUrl", e.target.value)}
                          placeholder="/shop"
                          className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-gray-700">Description</label>
                          <span className="text-[11px] text-gray-400 tabular-nums">
                            {(banner.description || "").length}/300
                          </span>
                        </div>
                        <textarea
                          rows={3}
                          value={banner.description || ""}
                          maxLength={300}
                          onChange={(e) => updateBanner(banner.id, "description", e.target.value)}
                          placeholder="Short subtitle or promotional copy shown on the slide..."
                          className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 resize-y leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PRODUCT CATEGORIES */}
      {activeTab === "categories" && (
        <div className="bg-white rounded-2xl border border-gray-200/80">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-950">Product Categories</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Organize products into filterable storefront categories.
              </p>
            </div>
            <button
              type="button"
              onClick={addCategory}
              className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            >
              <Plus size={14} /> Add Category
            </button>
          </div>

          <div className="p-5">
            {categories.length === 0 ? (
              <div className="py-14 text-center border border-dashed border-gray-200 rounded-xl">
                <Tags size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm font-medium text-gray-700">No categories configured</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-4">
                  Create categories so customers can filter products in the shop.
                </p>
                <button
                  type="button"
                  onClick={addCategory}
                  className="h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-gray-900 transition-colors cursor-pointer"
                >
                  <Plus size={14} /> Add Category
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Single Clean Column Header */}
                <div className="hidden sm:grid sm:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 px-2 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <span>Order</span>
                  <span>Category Label</span>
                  <span>URL Slug</span>
                  <span className="text-right">Del</span>
                </div>

                {categories.map((cat, index) => (
                  <div
                    key={cat.id}
                    className="grid grid-cols-1 sm:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-2.5 sm:gap-3 items-center p-3 sm:p-2 rounded-xl border border-gray-200/70 sm:border-transparent sm:hover:bg-gray-50/70 transition-colors"
                  >
                    <div className="flex items-center justify-between sm:justify-start gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveCategory(index, "up")}
                          disabled={index === 0}
                          title="Move up"
                          className="w-7 h-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-black disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategory(index, "down")}
                          disabled={index === categories.length - 1}
                          title="Move down"
                          className="w-7 h-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-black disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <ChevronDown size={13} />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCategory(cat.id)}
                        className="sm:hidden w-8 h-8 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={cat.label || ""}
                      onChange={(e) => updateCategoryLabel(cat.id, e.target.value)}
                      placeholder="Category label (e.g. Headphones)"
                      className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                    />

                    <input
                      type="text"
                      value={cat.slug || ""}
                      onChange={(e) => updateCategorySlug(cat.id, e.target.value)}
                      placeholder="headphones"
                      className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm font-mono text-gray-700 placeholder:text-gray-400 lowercase"
                    />

                    <button
                      type="button"
                      onClick={() => removeCategory(cat.id)}
                      title="Delete category"
                      className="hidden sm:flex w-10 h-10 rounded-xl border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 items-center justify-center transition-colors cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CONTACT & BUSINESS HOURS */}
      {activeTab === "contact" && (
        <div className="bg-white rounded-2xl border border-gray-200/80">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-950">Contact Details & Business Hours</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Displayed on the Contact page, order invoices, and storefront footer.
            </p>
          </div>

          <div className="p-5 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <Mail size={13} className="text-gray-400" /> Support Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="support@afratechpoint.com"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <Phone size={13} className="text-gray-400" /> Phone Number
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+880 1XXX-XXXXXX"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <MapPin size={13} className="text-gray-400" /> Store / Office Address
                </label>
                <input
                  type="text"
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  placeholder="Dhaka, Bangladesh"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Structured Business Hours */}
            <div className="pt-5 border-t border-gray-100 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-400" /> Business Hours
                </label>
                <span className="text-xs text-gray-500">
                  Preview: <strong className="font-semibold text-gray-900">{computedBusinessHours}</strong>
                </span>
              </div>

              <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-200/70 space-y-4">
                {/* Everyday Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-900">Open Every Day</p>
                    <p className="text-[11px] text-gray-500">
                      Enable if your support & store operate 7 days a week.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isEveryday}
                    onClick={() => setIsEveryday((prev) => !prev)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
                      isEveryday ? "bg-black" : "bg-gray-200"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform",
                        isEveryday ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                {/* Days + Time Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                  {!isEveryday && (
                    <div className="lg:col-span-5 grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                      <div className="space-y-1">
                        <span className="text-[11px] font-medium text-gray-500">Start Day</span>
                        <AdminSelect
                          value={bhStartDay}
                          onChange={setBhStartDay}
                          options={DAY_OPTIONS}
                        />
                      </div>
                      <span className="pb-2.5 text-xs font-medium text-gray-400">to</span>
                      <div className="space-y-1">
                        <span className="text-[11px] font-medium text-gray-500">End Day</span>
                        <AdminSelect
                          value={bhEndDay}
                          onChange={setBhEndDay}
                          options={END_DAY_OPTIONS}
                        />
                      </div>
                    </div>
                  )}

                  <div
                    className={cn(
                      "grid grid-cols-[1fr_92px_auto_1fr_92px] gap-2 items-end",
                      isEveryday ? "lg:col-span-12" : "lg:col-span-7"
                    )}
                  >
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-gray-500">Opening</span>
                      <input
                        type="text"
                        value={bhOpenTime}
                        onChange={(e) => setBhOpenTime(e.target.value)}
                        placeholder="9:00"
                        className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none text-sm font-medium text-center text-gray-900"
                      />
                    </div>
                    <AdminSelect
                      value={bhOpenPeriod}
                      onChange={setBhOpenPeriod}
                      options={PERIOD_OPTIONS}
                    />

                    <span className="pb-2.5 text-xs font-medium text-gray-400 text-center">to</span>

                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-gray-500">Closing</span>
                      <input
                        type="text"
                        value={bhCloseTime}
                        onChange={(e) => setBhCloseTime(e.target.value)}
                        placeholder="6:00"
                        className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none text-sm font-medium text-center text-gray-900"
                      />
                    </div>
                    <AdminSelect
                      value={bhClosePeriod}
                      onChange={setBhClosePeriod}
                      options={PERIOD_OPTIONS}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Save Bar */}
      <div className="flex justify-end pb-8">
        <button
          type="submit"
          disabled={isSaving}
          className="h-10 px-6 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save Changes
        </button>
      </div>

      {/* Media Picker Modal */}
      <MediaPickerModal
        isOpen={isMediaPickerOpen}
        onClose={() => {
          setIsMediaPickerOpen(false);
          setActiveBannerId(null);
        }}
        currentUrl={activeBanner?.imageUrl}
        onSelect={(url) => {
          if (activeBannerId) {
            updateBanner(activeBannerId, "imageUrl", url);
          }
          setIsMediaPickerOpen(false);
          setActiveBannerId(null);
        }}
      />
    </form>
  );
}
