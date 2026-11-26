"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  ImageIcon,
  Scissors,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import MediaPickerModal from "@/components/admin/MediaPickerModal";
import ImageCropperModal from "@/components/admin/ImageCropperModal";
import AdminSelect from "@/components/admin/AdminSelect";
import { authenticatedFetch } from "@/lib/api-helper";

interface NavItem {
  id: string;
  label: string;
  href: string;
}

interface SocialItem {
  id: string;
  platform: string;
  url: string;
}

interface PaymentMethodItem {
  id: string;
  name: string;
  accountNumber: string;
  enabled: boolean;
}

const CURRENCY_OPTIONS = [
  { value: "৳", label: "Bangladeshi Taka (৳)" },
  { value: "$", label: "US Dollar ($)" },
  { value: "€", label: "Euro (€)" },
  { value: "£", label: "British Pound (£)" },
  { value: "₹", label: "Indian Rupee (₹)" },
  { value: "¥", label: "Japanese Yen (¥)" },
  { value: "C$", label: "Canadian Dollar (C$)" },
  { value: "A$", label: "Australian Dollar (A$)" },
];

const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Twitter / X",
  "LinkedIn",
  "YouTube",
  "WhatsApp",
  "Telegram",
  "Pinterest",
  "TikTok",
];

const SOCIAL_PLATFORM_OPTIONS = [
  ...SOCIAL_PLATFORMS.map((p) => ({ value: p, label: p })),
  { value: "Custom", label: "Custom…" },
];

const CORE_PROVIDERS = ["bKash", "Nagad", "Rocket"];

const INPUT =
  "w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400";

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
        checked ? "bg-black" : "bg-gray-200"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function NavigationEditor({
  title,
  items,
  setItems,
  predefinedItems,
  labelPlaceholder = "Label",
  linkPlaceholder = "/path",
}: {
  title: string;
  items: NavItem[];
  setItems: React.Dispatch<React.SetStateAction<NavItem[]>>;
  predefinedItems?: { label: string; href: string }[];
  labelPlaceholder?: string;
  linkPlaceholder?: string;
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const addItem = (label = "", href = "") => {
    setItems((prev) => [...prev, { id: Date.now().toString(), label, href }]);
    setShowAddMenu(false);
  };

  const updateItem = (id: string, field: "label" | "href", value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  const quickPages =
    predefinedItems && predefinedItems.length > 0
      ? predefinedItems
      : [
          { label: "Home", href: "/" },
          { label: "Shop", href: "/shop" },
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
          { label: "Cart", href: "/cart" },
        ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-950">{title}</h2>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setShowAddMenu((prev) => !prev)}
            className="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-900 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus size={13} /> Add Link
            <ChevronDown
              size={12}
              className={cn("text-gray-400 transition-transform", showAddMenu && "rotate-180")}
            />
          </button>

          {showAddMenu && (
            <div className="absolute right-0 mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
              {quickPages.map((page) => (
                <button
                  key={`${page.label}-${page.href}`}
                  type="button"
                  onClick={() => addItem(page.label, page.href)}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 hover:text-gray-950 transition-colors cursor-pointer"
                >
                  {page.label}
                </button>
              ))}
              <div className="h-px bg-gray-100 my-1" />
              <button
                type="button"
                onClick={() => addItem("", "")}
                className="w-full text-left px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                + Custom Link
              </button>
            </div>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-gray-400">
          No links added yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="px-5 py-3 grid grid-cols-1 sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.4fr)_36px] gap-2.5 items-center"
            >
              <div className="flex items-center justify-between sm:justify-start gap-1">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveItem(index, "up")}
                    disabled={index === 0}
                    className="w-6 h-6 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, "down")}
                    disabled={index === items.length - 1}
                    className="w-6 h-6 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="sm:hidden text-gray-400 hover:text-red-600 p-1 cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <input
                type="text"
                value={item.label || ""}
                onChange={(e) => updateItem(item.id, "label", e.target.value)}
                placeholder={labelPlaceholder}
                className={INPUT}
              />

              <input
                type="text"
                value={item.href || ""}
                onChange={(e) => updateItem(item.id, "href", e.target.value)}
                placeholder={linkPlaceholder}
                className={cn(INPUT, "font-mono text-xs")}
              />

              <button
                type="button"
                onClick={() => removeItem(item.id)}
                title="Remove"
                className="hidden sm:flex w-9 h-9 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 items-center justify-center transition-colors cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SocialMediaEditor({
  items,
  setItems,
}: {
  items: SocialItem[];
  setItems: React.Dispatch<React.SetStateAction<SocialItem[]>>;
}) {
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), platform: "Facebook", url: "" },
    ]);
  };

  const updateItem = (id: string, field: "platform" | "url", value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-950">Social Links</h2>
        <button
          type="button"
          onClick={addItem}
          className="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-900 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus size={13} /> Add Profile
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-gray-400">
          No social profiles added yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((item, index) => {
            const isKnown = SOCIAL_PLATFORMS.includes(item.platform);
            const selectValue = isKnown ? item.platform : "Custom";

            return (
              <div
                key={item.id}
                className="px-5 py-3 grid grid-cols-1 sm:grid-cols-[56px_180px_minmax(0,1fr)_36px] gap-2.5 items-start"
              >
                <div className="flex items-center justify-between sm:justify-start gap-1 sm:pt-2">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveItem(index, "up")}
                      disabled={index === 0}
                      className="w-6 h-6 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, "down")}
                      disabled={index === items.length - 1}
                      className="w-6 h-6 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="sm:hidden text-gray-400 hover:text-red-600 p-1 cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <AdminSelect
                    value={selectValue}
                    onChange={(val) =>
                      updateItem(item.id, "platform", val === "Custom" ? "" : val)
                    }
                    options={SOCIAL_PLATFORM_OPTIONS}
                  />
                  {!isKnown && (
                    <input
                      type="text"
                      value={item.platform || ""}
                      onChange={(e) => updateItem(item.id, "platform", e.target.value)}
                      placeholder="Platform name"
                      className="w-full h-9 px-3 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs text-gray-900"
                    />
                  )}
                </div>

                <input
                  type="url"
                  value={item.url || ""}
                  onChange={(e) => updateItem(item.id, "url", e.target.value)}
                  placeholder="https://facebook.com/yourpage"
                  className={INPUT}
                />

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  title="Remove"
                  className="hidden sm:flex w-9 h-9 mt-0.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 items-center justify-center transition-colors cursor-pointer"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminSettings() {
  const [storeName, setStoreName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [currencySymbol, setCurrencySymbol] = useState("৳");
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementActive, setAnnouncementActive] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [navLinks, setNavLinks] = useState<NavItem[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialItem[]>([]);
  const [footerProducts, setFooterProducts] = useState<NavItem[]>([]);
  const [footerCompany, setFooterCompany] = useState<NavItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);
  const [codEnabled, setCodEnabled] = useState<boolean>(true);
  const [deliveryCharge, setDeliveryCharge] = useState<string>("0");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "header" | "footer" | "social">("general");

  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [pickingFor, setPickingFor] = useState<"logo" | "signature" | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  useEffect(() => {
    authenticatedFetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setStoreName(data.storeName || "");
        setShortDescription(data.shortDescription || "");
        setLogoUrl(data.logoUrl || "");
        setSignatureUrl(data.signatureUrl || "");
        setCurrencySymbol(data.currencySymbol || "৳");
        setAnnouncementText(data.announcementText || "");
        setAnnouncementActive(Boolean(data.announcementActive));
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setNavLinks(Array.isArray(data.navLinks) ? data.navLinks : []);
        setSocialLinks(Array.isArray(data.socialLinks) ? data.socialLinks : []);
        setFooterProducts(Array.isArray(data.footerProducts) ? data.footerProducts : []);
        setFooterCompany(Array.isArray(data.footerCompany) ? data.footerCompany : []);
        setPaymentMethods(Array.isArray(data.paymentMethods) ? data.paymentMethods : []);
        setCodEnabled(data.codEnabled !== false);
        setDeliveryCharge(String(Number(data.deliveryCharge) || 0));
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings", err);
        setIsLoading(false);
      });
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);

    try {
      const res = await authenticatedFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: storeName.trim(),
          shortDescription: shortDescription.trim(),
          logoUrl,
          signatureUrl,
          currencySymbol,
          themeId: "midnight",
          announcementText: announcementText.trim(),
          announcementActive,
          navLinks,
          socialLinks,
          footerProducts,
          footerCompany,
          paymentMethods,
          codEnabled,
          deliveryCharge: Math.max(0, Number(deliveryCharge) || 0),
        }),
      });

      if (res.ok) {
        toast.success("Settings saved");
      } else {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to save settings");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCropComplete = async (blob: Blob) => {
    setIsCropping(true);
    const formData = new FormData();
    formData.append("files", blob, `cropped-logo-${Date.now()}.jpg`);

    try {
      const res = await authenticatedFetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.files.length > 0) {
        setLogoUrl(data.files[0].url);
        toast.success("Logo updated");
      }
    } catch {
      toast.error("Failed to upload cropped logo");
    } finally {
      setIsCropping(false);
      setIsCropperOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const tabs = [
    { id: "general", label: "General" },
    { id: "header", label: "Header" },
    { id: "footer", label: "Footer" },
    { id: "social", label: "Social" },
  ] as const;

  return (
    <form onSubmit={handleSave} className="w-full space-y-6 pb-12">
      {/* Clean Underline Tabs + Save Button */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200">
        <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "pb-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer",
                  isActive
                    ? "border-black text-gray-950 font-semibold"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="mb-2 h-9 px-4 rounded-xl bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center gap-2 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
        >
          {isSaving && <Loader2 size={13} className="animate-spin" />}
          {isSaving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* TAB 1: GENERAL */}
      {activeTab === "general" && (
        <div className="space-y-6">
          {/* Section 1: Storefront */}
          <div className="bg-white rounded-2xl border border-gray-200/80 divide-y divide-gray-100">
            {/* Row 1: Store Name & Currency */}
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">Store Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Afra Tech Point"
                  className={INPUT}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">Currency</label>
                <AdminSelect
                  value={currencySymbol}
                  onChange={setCurrencySymbol}
                  options={CURRENCY_OPTIONS}
                />
              </div>
            </div>

            {/* Row 2: Store Logo */}
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Store Logo</p>
                <p className="text-xs text-gray-500">Displayed in the site header and invoices.</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="w-full h-full object-contain p-1.5"
                    />
                  ) : (
                    <ImageIcon size={16} className="text-gray-400" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPickingFor("logo");
                    setIsMediaPickerOpen(true);
                  }}
                  className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-900 transition-colors cursor-pointer"
                >
                  {logoUrl ? "Change" : "Upload"}
                </button>

                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageToCrop(logoUrl);
                      setIsCropperOpen(true);
                    }}
                    title="Crop Logo"
                    className="h-9 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {isCropping ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Scissors size={13} />
                    )}
                    Crop
                  </button>
                )}
              </div>
            </div>

            {/* Row 3: Invoice Signature */}
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Invoice Signature</p>
                <p className="text-xs text-gray-500">Optional transparent PNG for order invoices.</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-20 h-12 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                  {signatureUrl ? (
                    <img
                      src={signatureUrl}
                      alt="Signature"
                      className="w-full h-full object-contain p-1.5"
                    />
                  ) : (
                    <span className="text-[11px] text-gray-400">None</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPickingFor("signature");
                    setIsMediaPickerOpen(true);
                  }}
                  className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-900 transition-colors cursor-pointer"
                >
                  {signatureUrl ? "Change" : "Select"}
                </button>

                {signatureUrl && (
                  <button
                    type="button"
                    onClick={() => setSignatureUrl("")}
                    title="Remove Signature"
                    className="w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-gray-400 hover:text-red-600 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Row 4: Announcement Bar */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">Announcement Bar</p>
                  <p className="text-xs text-gray-500">Top notice banner above the site header.</p>
                </div>
                <Switch
                  checked={announcementActive}
                  onChange={() => setAnnouncementActive((prev) => !prev)}
                />
              </div>

              {announcementActive && (
                <input
                  type="text"
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="e.g. Free delivery on orders over ৳2,000!"
                  className={INPUT}
                />
              )}
            </div>
          </div>

          {/* Section 2: Payments & Delivery */}
          <div className="bg-white rounded-2xl border border-gray-200/80 divide-y divide-gray-100">
            {/* Delivery Charge Row */}
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Delivery Charge</p>
                <p className="text-xs text-gray-500">Shipping fee for physical orders (0 for free).</p>
              </div>
              <div className="relative w-32 shrink-0">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                  {currencySymbol}
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={deliveryCharge}
                  onChange={(e) => setDeliveryCharge(e.target.value)}
                  className="w-full h-10 pl-8 pr-3.5 rounded-xl bg-white border border-gray-200 focus:border-black outline-none text-sm font-semibold text-right text-gray-900 tabular-nums"
                />
              </div>
            </div>

            {/* Cash on Delivery Row */}
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Cash on Delivery</p>
                <p className="text-xs text-gray-500">Allow customers to pay cash upon parcel delivery.</p>
              </div>
              <Switch
                checked={codEnabled}
                onChange={() => setCodEnabled((prev) => !prev)}
              />
            </div>

            {/* Mobile Banking Section */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Mobile Banking</p>
                  <p className="text-xs text-gray-500">Numbers shown to customers at checkout.</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPaymentMethods((prev) => [
                      ...prev,
                      {
                        id: Date.now().toString(),
                        name: prev.length === 0 ? "bKash" : "Upay",
                        accountNumber: "",
                        enabled: true,
                      },
                    ])
                  }
                  className="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-900 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus size={13} /> Add Number
                </button>
              </div>

              {paymentMethods.length > 0 && (
                <div className="pt-1 space-y-2.5">
                  {paymentMethods.map((method) => {
                    const isCore = CORE_PROVIDERS.includes(method.name);
                    return (
                      <div
                        key={method.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2.5"
                      >
                        {isCore ? (
                          <span className="sm:w-28 h-10 px-3.5 rounded-xl bg-gray-100 text-xs font-semibold text-gray-900 inline-flex items-center shrink-0">
                            {method.name}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={method.name}
                            onChange={(e) =>
                              setPaymentMethods((prev) =>
                                prev.map((m) =>
                                  m.id === method.id ? { ...m, name: e.target.value } : m
                                )
                              )
                            }
                            placeholder="Provider"
                            className="sm:w-28 h-10 px-3 rounded-xl bg-white border border-gray-200 focus:border-black outline-none text-xs font-semibold text-gray-900 shrink-0"
                          />
                        )}

                        <input
                          type="tel"
                          value={method.accountNumber || ""}
                          onChange={(e) =>
                            setPaymentMethods((prev) =>
                              prev.map((m) =>
                                m.id === method.id
                                  ? { ...m, accountNumber: e.target.value }
                                  : m
                              )
                            )
                          }
                          placeholder={`01XXXXXXXXX`}
                          className={cn(INPUT, "flex-1 font-mono")}
                        />

                        <div className="flex items-center justify-between sm:justify-end gap-3 pl-1">
                          <Switch
                            checked={method.enabled}
                            onChange={() =>
                              setPaymentMethods((prev) =>
                                prev.map((m) =>
                                  m.id === method.id ? { ...m, enabled: !m.enabled } : m
                                )
                              )
                            }
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setPaymentMethods((prev) =>
                                prev.filter((m) => m.id !== method.id)
                              )
                            }
                            title="Remove"
                            className="w-9 h-9 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HEADER */}
      {activeTab === "header" && (
        <NavigationEditor
          title="Header Menu"
          items={navLinks}
          setItems={setNavLinks}
        />
      )}

      {/* TAB 3: FOOTER */}
      {activeTab === "footer" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-950">Footer Description</label>
              <span className="text-xs text-gray-400 tabular-nums">
                {shortDescription.length}/240
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={240}
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Short store bio shown beneath the logo in the footer…"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 resize-y"
            />
          </div>

          <NavigationEditor
            title="Product Category Links"
            items={footerProducts}
            setItems={setFooterProducts}
            predefinedItems={categories.map((c: any) => ({
              label: c.label,
              href: `/shop?category=${encodeURIComponent(c.label)}`,
            }))}
          />

          <NavigationEditor
            title="Company Links"
            items={footerCompany}
            setItems={setFooterCompany}
            predefinedItems={[
              { label: "About Us", href: "/about" },
              { label: "Contact Us", href: "/contact" },
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Terms of Service", href: "/terms" },
            ]}
          />
        </div>
      )}

      {/* TAB 4: SOCIAL */}
      {activeTab === "social" && (
        <SocialMediaEditor items={socialLinks} setItems={setSocialLinks} />
      )}

      {/* Media Library Picker Modal */}
      <MediaPickerModal
        isOpen={isMediaPickerOpen}
        onClose={() => {
          setIsMediaPickerOpen(false);
          setPickingFor(null);
        }}
        onSelect={(url) => {
          if (pickingFor === "logo") setLogoUrl(url);
          else if (pickingFor === "signature") setSignatureUrl(url);
          setIsMediaPickerOpen(false);
          setPickingFor(null);
        }}
        currentUrl={pickingFor === "logo" ? logoUrl : signatureUrl}
      />

      {/* Image Cropper Modal */}
      {imageToCrop && (
        <ImageCropperModal
          image={imageToCrop}
          isOpen={isCropperOpen}
          onClose={() => setIsCropperOpen(false)}
          onCropComplete={handleCropComplete}
        />
      )}
    </form>
  );
}
