"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Plus,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Package,
  Zap,
  Check,
  Infinity as InfinityIcon,
  Ban,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import AdminSelect from "@/components/admin/AdminSelect";
import { authenticatedFetch } from "@/lib/api-helper";
import {
  hasPerVariantStock,
  resolveVirtualStockMode,
  type StockableProduct,
} from "@/lib/inventory";
import type {
  Credential,
  LicenseKey,
  VirtualStockMode,
} from "@/types/product";

interface ManageStockModalProps {
  product: (StockableProduct & Record<string, any>) | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updatedProduct?: any) => void;
}

type PhysicalStockMode = "single" | "variants" | "unlimited" | "out_of_stock";

const INPUT =
  "w-full h-9 px-3 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs text-gray-900 placeholder:text-gray-400";

export default function ManageStockModal({
  product,
  isOpen,
  onClose,
  onSaved,
}: ManageStockModalProps) {
  const [saving, setSaving] = useState(false);

  // Physical mode state
  const [physMode, setPhysMode] = useState<PhysicalStockMode>("single");
  const [singleStock, setSingleStock] = useState<number>(0);
  const [addDelta, setAddDelta] = useState<string>("");
  const [variantStocks, setVariantStocks] = useState<Record<string, number>>({});
  const [variantAddDeltas, setVariantAddDeltas] = useState<Record<string, string>>({});

  // Virtual mode state
  const [virtMode, setVirtMode] = useState<VirtualStockMode>("unlimited");
  const [licensePool, setLicensePool] = useState<LicenseKey[]>([]);
  const [bulkKeysText, setBulkKeysText] = useState("");
  const [keyNote, setKeyNote] = useState("");
  const [keyVariant, setKeyVariant] = useState("");

  const [credentialPool, setCredentialPool] = useState<Credential[]>([]);
  const [accEmail, setAccEmail] = useState("");
  const [accPassword, setAccPassword] = useState("");
  const [accNote, setAccNote] = useState("");
  const [accVariant, setAccVariant] = useState("");
  const [bulkAccountsMode, setBulkAccountsMode] = useState(false);
  const [bulkAccountsText, setBulkAccountsText] = useState("");
  const [visibleCredIds, setVisibleCredIds] = useState<Record<string, boolean>>({});

  const isVirt = product?.productKind === "virtual";
  const vType = product?.virtualType || "social";
  const supportsPool = isVirt && (vType === "license" || vType === "account");
  const variants = Array.isArray(product?.variants) ? product!.variants! : [];
  const hasVariants = variants.length > 0;

  useEffect(() => {
    if (!product || !isOpen) return;

    // Initialize shared numeric stock states
    const initialSingle =
      product.stock !== undefined && product.stock !== null
        ? Math.max(0, Number(product.stock) || 0)
        : 0;
    setSingleStock(initialSingle);
    setAddDelta("");

    const vMap: Record<string, number> = {};
    const vDeltas: Record<string, string> = {};
    variants.forEach((v) => {
      const key = v.id || v.name;
      vMap[key] =
        v.stock !== undefined && v.stock !== null ? Math.max(0, Number(v.stock) || 0) : 0;
      vDeltas[key] = "";
    });
    setVariantStocks(vMap);
    setVariantAddDeltas(vDeltas);

    if (product.productKind === "virtual") {
      const resolved = resolveVirtualStockMode(product);
      setVirtMode(resolved);
      setLicensePool(
        Array.isArray(product.virtualConfig?.licensePool)
          ? [...product.virtualConfig!.licensePool!]
          : []
      );
      setCredentialPool(
        Array.isArray(product.virtualConfig?.credentialPool)
          ? [...product.virtualConfig!.credentialPool!]
          : []
      );
      if (resolved === "quantity") {
        setPhysMode(hasVariants && hasPerVariantStock(product) ? "variants" : "single");
      } else {
        setPhysMode("single");
      }
    } else {
      if (hasVariants && hasPerVariantStock(product)) {
        setPhysMode("variants");
      } else if (product.stock === undefined || product.stock === null) {
        setPhysMode("unlimited");
      } else if (Number(product.stock) <= 0) {
        setPhysMode("out_of_stock");
      } else {
        setPhysMode("single");
      }
    }

    setBulkKeysText("");
    setKeyNote("");
    setKeyVariant("");
    setAccEmail("");
    setAccPassword("");
    setAccNote("");
    setAccVariant("");
    setBulkAccountsMode(false);
    setBulkAccountsText("");
    setVisibleCredIds({});
  }, [product, isOpen]);

  if (!product) return null;

  const variantSelectOptions = [
    { value: "", label: "All Variants (Shared)" },
    ...variants.map((v) => ({ value: v.name, label: v.name })),
  ];

  // Quick Add Stock Helpers
  const applySingleDelta = (delta: number) => {
    setSingleStock((prev) => Math.max(0, prev + delta));
    setAddDelta("");
  };

  const applyVariantDelta = (key: string, delta: number) => {
    setVariantStocks((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta),
    }));
    setVariantAddDeltas((prev) => ({ ...prev, [key]: "" }));
  };

  // Add License Keys (1 per line)
  const handleAddKeys = () => {
    const lines = bulkKeysText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste at least one license key");
      return;
    }
    const newEntries: LicenseKey[] = lines.map((k, idx) => ({
      id: `lk_${Date.now()}_${idx}`,
      key: k,
      ...(keyNote.trim() ? { note: keyNote.trim() } : {}),
      ...(keyVariant ? { variantName: keyVariant } : {}),
    }));
    setLicensePool((prev) => [...prev, ...newEntries]);
    setBulkKeysText("");
    setKeyNote("");
    toast.success(`Added ${newEntries.length} key${newEntries.length > 1 ? "s" : ""}`);
  };

  // Add Single Account
  const handleAddSingleAccount = () => {
    if (!accEmail.trim() || !accPassword.trim()) {
      toast.error("Enter both Email/Username and Password");
      return;
    }
    const entry: Credential = {
      id: `cr_${Date.now()}`,
      email: accEmail.trim(),
      password: accPassword.trim(),
      ...(accNote.trim() ? { note: accNote.trim() } : {}),
      ...(accVariant ? { variantName: accVariant } : {}),
    };
    setCredentialPool((prev) => [...prev, entry]);
    setAccEmail("");
    setAccPassword("");
    setAccNote("");
    toast.success("Account added to stock");
  };

  // Bulk Paste Accounts (email:password or email|password per line)
  const handleAddBulkAccounts = () => {
    const lines = bulkAccountsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste accounts in email:password format");
      return;
    }

    const added: Credential[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sepIdx = line.includes("|") ? line.indexOf("|") : line.indexOf(":");
      if (sepIdx === -1) continue;
      const email = line.slice(0, sepIdx).trim();
      const rest = line.slice(sepIdx + 1).trim();
      if (!email || !rest) continue;

      // Support optional 3rd segment email:password:note
      const noteSep = rest.includes("|") ? rest.indexOf("|") : -1;
      const password = noteSep !== -1 ? rest.slice(0, noteSep).trim() : rest;
      const extraNote = noteSep !== -1 ? rest.slice(noteSep + 1).trim() : accNote.trim();

      added.push({
        id: `cr_${Date.now()}_${i}`,
        email,
        password,
        ...(extraNote ? { note: extraNote } : {}),
        ...(accVariant ? { variantName: accVariant } : {}),
      });
    }

    if (added.length === 0) {
      toast.error("Use format: email:password (one per line)");
      return;
    }

    setCredentialPool((prev) => [...prev, ...added]);
    setBulkAccountsText("");
    toast.success(`Added ${added.length} account${added.length > 1 ? "s" : ""}`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    // Apply any unapplied typed +Add delta automatically so user never loses typed restock numbers
    const pendingSingleAdd = parseInt(addDelta, 10) || 0;
    const finalSingleStock = Math.max(0, singleStock + pendingSingleAdd);

    const buildUpdatedVariants = (usePerVariant: boolean) => {
      return variants.map((v) => {
        const key = v.id || v.name;
        if (!usePerVariant) {
          const { stock: _removed, ...rest } = v as any;
          return { ...rest, stock: null };
        }
        const pendingVarAdd = parseInt(variantAddDeltas[key] || "", 10) || 0;
        const nextVarStock = Math.max(0, (variantStocks[key] || 0) + pendingVarAdd);
        return { ...v, stock: nextVarStock };
      });
    };

    let payload: Record<string, any> = {};

    if (!isVirt) {
      if (physMode === "unlimited") {
        payload = {
          stock: null,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
        };
      } else if (physMode === "out_of_stock") {
        payload = {
          stock: 0,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
        };
      } else if (physMode === "variants" && hasVariants) {
        const nextVars = buildUpdatedVariants(true);
        const totalSum = nextVars.reduce((s, v) => s + (Number(v.stock) || 0), 0);
        payload = {
          stock: totalSum,
          variants: nextVars,
        };
      } else {
        payload = {
          stock: finalSingleStock,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
        };
      }
    } else {
      // Virtual Product Payload
      const existingCfg = product.virtualConfig || {};
      if (virtMode === "pool") {
        const poolTotal =
          vType === "license" ? licensePool.length : credentialPool.length;
        payload = {
          stock: poolTotal,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
          virtualConfig: {
            ...existingCfg,
            stockMode: "pool",
            ...(vType === "license" ? { licensePool } : {}),
            ...(vType === "account" ? { credentialPool } : {}),
          },
        };
      } else if (virtMode === "quantity") {
        const useVar = hasVariants && physMode === "variants";
        const nextVars = hasVariants ? buildUpdatedVariants(useVar) : undefined;
        const totalQty = useVar
          ? nextVars!.reduce((s, v) => s + (Number(v.stock) || 0), 0)
          : finalSingleStock;
        payload = {
          stock: totalQty,
          ...(nextVars ? { variants: nextVars } : {}),
          virtualConfig: {
            ...existingCfg,
            stockMode: "quantity",
            licensePool,
            credentialPool,
          },
        };
      } else if (virtMode === "out_of_stock") {
        payload = {
          stock: 0,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
          virtualConfig: {
            ...existingCfg,
            stockMode: "out_of_stock",
            licensePool,
            credentialPool,
          },
        };
      } else {
        // unlimited
        payload = {
          stock: null,
          ...(hasVariants ? { variants: buildUpdatedVariants(false) } : {}),
          virtualConfig: {
            ...existingCfg,
            stockMode: "unlimited",
            licensePool,
            credentialPool,
          },
        };
      }
    }

    try {
      const res = await authenticatedFetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save stock");
      const json = await res.json();
      toast.success("Stock updated");
      onSaved(json?.product);
      onClose();
    } catch {
      toast.error("Failed to update stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => {
            if (!saving) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] bg-white rounded-2xl border border-gray-200 shadow-xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : isVirt ? (
                    <Zap size={16} className="text-gray-400" />
                  ) : (
                    <Package size={16} className="text-gray-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-950 truncate">{product.name}</h3>
                  <p className="text-xs text-gray-500">
                    {isVirt ? `Virtual · ${String(vType).toUpperCase()}` : "Physical Product"}
                    {hasVariants ? ` · ${variants.length} variants` : ""}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-800 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-5 overflow-y-auto flex-1">
                {/* ═══════════════════════════════════════════════════════
                    VIRTUAL STOCK MODE SELECTOR
                   ═══════════════════════════════════════════════════════ */}
                {isVirt && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-700">
                      Stock Mode
                    </label>
                    <div
                      className={cn(
                        "grid gap-2",
                        supportsPool ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
                      )}
                    >
                      {supportsPool && (
                        <button
                          type="button"
                          onClick={() => setVirtMode("pool")}
                          className={cn(
                            "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                            virtMode === "pool"
                              ? "bg-black text-white border-black"
                              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                          )}
                        >
                          {vType === "license" ? "Key List" : "Account List"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setVirtMode("quantity")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                          virtMode === "quantity"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        Quantity
                      </button>
                      <button
                        type="button"
                        onClick={() => setVirtMode("unlimited")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1 cursor-pointer",
                          virtMode === "unlimited"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        <InfinityIcon size={13} /> Unlimited
                      </button>
                      <button
                        type="button"
                        onClick={() => setVirtMode("out_of_stock")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1 cursor-pointer",
                          virtMode === "out_of_stock"
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        <Ban size={12} /> Out
                      </button>
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    PHYSICAL STOCK MODE SELECTOR
                   ═══════════════════════════════════════════════════════ */}
                {!isVirt && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-700">
                      Stock Tracking
                    </label>
                    <div
                      className={cn(
                        "grid gap-2",
                        hasVariants ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
                      )}
                    >
                      {hasVariants && (
                        <button
                          type="button"
                          onClick={() => setPhysMode("variants")}
                          className={cn(
                            "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                            physMode === "variants"
                              ? "bg-black text-white border-black"
                              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                          )}
                        >
                          Per Variant
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPhysMode("single")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                          physMode === "single"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        {hasVariants ? "Single Total" : "Track Quantity"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhysMode("unlimited")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1 cursor-pointer",
                          physMode === "unlimited"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        <InfinityIcon size={13} /> Unlimited
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhysMode("out_of_stock")}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1 cursor-pointer",
                          physMode === "out_of_stock"
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        <Ban size={12} /> Out of Stock
                      </button>
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    VIRTUAL POOL: LICENSE KEYS
                   ═══════════════════════════════════════════════════════ */}
                {isVirt && virtMode === "pool" && vType === "license" && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-900">Add License Keys</p>
                        <span className="text-[11px] text-gray-500">One key per line</span>
                      </div>

                      {hasVariants && (
                        <AdminSelect
                          size="sm"
                          value={keyVariant}
                          onChange={setKeyVariant}
                          options={variantSelectOptions}
                        />
                      )}

                      <textarea
                        rows={3}
                        value={bulkKeysText}
                        onChange={(e) => setBulkKeysText(e.target.value)}
                        placeholder={"XXXXX-XXXXX-XXXXX-XXXXX\nYYYYY-YYYYY-YYYYY-YYYYY"}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-mono text-gray-900 placeholder:text-gray-400 resize-y"
                      />

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={keyNote}
                          onChange={(e) => setKeyNote(e.target.value)}
                          placeholder="Activation note (optional)"
                          className={cn(INPUT, "flex-1")}
                        />
                        <button
                          type="button"
                          onClick={handleAddKeys}
                          className="h-9 px-3.5 rounded-lg bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <Plus size={13} /> Add Keys
                        </button>
                      </div>
                    </div>

                    {/* Existing Keys Pool */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">
                          Available Keys ({licensePool.length})
                        </span>
                        {licensePool.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setLicensePool([])}
                            className="text-[11px] text-gray-400 hover:text-red-600 cursor-pointer"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      {licensePool.length === 0 ? (
                        <div className="py-6 text-center border border-dashed border-gray-200 rounded-xl text-xs text-gray-400">
                          0 keys in stock — product will show as Out of Stock.
                        </div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white">
                          {licensePool.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-mono font-semibold text-gray-900 truncate">
                                  {item.key}
                                </p>
                                {(item.variantName || item.note) && (
                                  <p className="text-[11px] text-gray-400 truncate">
                                    {[item.variantName, item.note].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setLicensePool((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-gray-400 hover:text-red-600 p-1 shrink-0 cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    VIRTUAL POOL: PRE-STOCKED ACCOUNTS
                   ═══════════════════════════════════════════════════════ */}
                {isVirt && virtMode === "pool" && vType === "account" && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-900">
                          Add Account to Stock
                        </p>
                        <button
                          type="button"
                          onClick={() => setBulkAccountsMode((prev) => !prev)}
                          className="text-[11px] font-semibold text-gray-600 hover:text-black underline cursor-pointer"
                        >
                          {bulkAccountsMode ? "Single Entry" : "Bulk Paste"}
                        </button>
                      </div>

                      {hasVariants && (
                        <AdminSelect
                          size="sm"
                          value={accVariant}
                          onChange={setAccVariant}
                          options={variantSelectOptions}
                        />
                      )}

                      {!bulkAccountsMode ? (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={accEmail}
                              onChange={(e) => setAccEmail(e.target.value)}
                              placeholder="Email / Username"
                              className={cn(INPUT, "font-mono")}
                            />
                            <input
                              type="text"
                              value={accPassword}
                              onChange={(e) => setAccPassword(e.target.value)}
                              placeholder="Password"
                              className={cn(INPUT, "font-mono")}
                            />
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={accNote}
                              onChange={(e) => setAccNote(e.target.value)}
                              placeholder="PIN / Profile / Validity note (optional)"
                              className={cn(INPUT, "flex-1")}
                            />
                            <button
                              type="button"
                              onClick={handleAddSingleAccount}
                              className="h-9 px-3.5 rounded-lg bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                            >
                              <Plus size={13} /> Add
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <textarea
                            rows={3}
                            value={bulkAccountsText}
                            onChange={(e) => setBulkAccountsText(e.target.value)}
                            placeholder={"account1@mail.com:pass123\naccount2@mail.com:pass456"}
                            className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 focus:border-black outline-none text-xs font-mono text-gray-900 placeholder:text-gray-400 resize-y"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-gray-500">
                              Format: <code>email:password</code> (1 per line)
                            </span>
                            <button
                              type="button"
                              onClick={handleAddBulkAccounts}
                              className="h-8 px-3.5 rounded-lg bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Plus size={13} /> Add All
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Existing Accounts Pool */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">
                          Available Accounts ({credentialPool.length})
                        </span>
                        {credentialPool.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setCredentialPool([])}
                            className="text-[11px] text-gray-400 hover:text-red-600 cursor-pointer"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      {credentialPool.length === 0 ? (
                        <div className="py-6 text-center border border-dashed border-gray-200 rounded-xl text-xs text-gray-400">
                          0 accounts in stock — product will show as Out of Stock.
                        </div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white">
                          {credentialPool.map((cred, idx) => {
                            const showPw = !!visibleCredIds[cred.id];
                            return (
                              <div
                                key={cred.id || idx}
                                className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-mono font-semibold text-gray-900 truncate">
                                    {cred.email}{" "}
                                    <span className="text-gray-400">·</span>{" "}
                                    <span className="text-gray-600">
                                      {showPw ? cred.password : "••••••••"}
                                    </span>
                                  </p>
                                  {(cred.variantName || cred.note) && (
                                    <p className="text-[11px] text-gray-400 truncate">
                                      {[cred.variantName, cred.note].filter(Boolean).join(" · ")}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVisibleCredIds((prev) => ({
                                        ...prev,
                                        [cred.id]: !prev[cred.id],
                                      }))
                                    }
                                    className="text-gray-400 hover:text-gray-900 p-1 cursor-pointer"
                                  >
                                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCredentialPool((prev) =>
                                        prev.filter((_, i) => i !== idx)
                                      )
                                    }
                                    className="text-gray-400 hover:text-red-600 p-1 cursor-pointer"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════
                    NUMERIC QUANTITY CONTROLS (PHYSICAL OR VIRTUAL QUANTITY)
                   ═══════════════════════════════════════════════════════ */}
                {((!isVirt && (physMode === "single" || physMode === "variants")) ||
                  (isVirt && virtMode === "quantity")) && (
                  <div className="space-y-4">
                    {/* Sub-toggle when Virtual + Has Variants */}
                    {isVirt && hasVariants && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPhysMode("variants")}
                          className={cn(
                            "h-8 px-3 rounded-lg border text-xs font-semibold cursor-pointer",
                            physMode === "variants"
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-600 border-gray-200"
                          )}
                        >
                          Per-Variant Stock
                        </button>
                        <button
                          type="button"
                          onClick={() => setPhysMode("single")}
                          className={cn(
                            "h-8 px-3 rounded-lg border text-xs font-semibold cursor-pointer",
                            physMode === "single"
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-600 border-gray-200"
                          )}
                        >
                          Single Shared Stock
                        </button>
                      </div>
                    )}

                    {/* PER-VARIANT STOCK EDITOR */}
                    {hasVariants && physMode === "variants" ? (
                      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
                        <div className="px-4 py-2.5 bg-gray-50/70 grid grid-cols-[minmax(0,1fr)_88px_132px] gap-2.5 text-[11px] font-semibold text-gray-500">
                          <span>Variant</span>
                          <span className="text-center">Current</span>
                          <span className="text-right">+ Add Stock</span>
                        </div>
                        {variants.map((v) => {
                          const key = v.id || v.name;
                          const current = variantStocks[key] ?? 0;
                          const deltaVal = variantAddDeltas[key] || "";
                          return (
                            <div
                              key={key}
                              className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_88px_132px] gap-2.5 items-center"
                            >
                              <span className="text-xs font-semibold text-gray-900 truncate">
                                {v.name}
                              </span>

                              <input
                                type="number"
                                min="0"
                                value={current}
                                onChange={(e) =>
                                  setVariantStocks((prev) => ({
                                    ...prev,
                                    [key]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  }))
                                }
                                className="h-9 px-2.5 rounded-lg border border-gray-200 focus:border-black outline-none text-xs font-bold text-center text-gray-900 tabular-nums"
                              />

                              <div className="flex items-center gap-1.5 justify-end">
                                <input
                                  type="number"
                                  min="1"
                                  value={deltaVal}
                                  onChange={(e) =>
                                    setVariantAddDeltas((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  placeholder="+Qty"
                                  className="w-16 h-9 px-2 rounded-lg border border-gray-200 focus:border-black outline-none text-xs font-semibold text-center tabular-nums"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const d = parseInt(deltaVal, 10) || 0;
                                    if (d > 0) applyVariantDelta(key, d);
                                  }}
                                  className="h-9 px-2.5 rounded-lg bg-gray-900 hover:bg-black text-white text-xs font-semibold cursor-pointer"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* SINGLE STOCK EDITOR */
                      <div className="p-4 rounded-xl bg-gray-50 border border-gray-200/80 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Quick Restock (+ Add) */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-gray-900">
                              Add New Stock (+ Restock)
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="1"
                                value={addDelta}
                                onChange={(e) => setAddDelta(e.target.value)}
                                placeholder="e.g. 20"
                                className={cn(INPUT, "font-semibold tabular-nums")}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const d = parseInt(addDelta, 10) || 0;
                                  if (d > 0) applySingleDelta(d);
                                }}
                                className="h-9 px-3.5 rounded-lg bg-black hover:bg-gray-900 text-white text-xs font-semibold shrink-0 cursor-pointer"
                              >
                                + Add
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                              {[5, 10, 25, 50].map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => applySingleDelta(preset)}
                                  className="px-2 py-0.5 rounded-md bg-white border border-gray-200 hover:border-black text-[11px] font-semibold text-gray-700 cursor-pointer"
                                >
                                  +{preset}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Exact Stock Override */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-gray-700">
                              Exact Total Stock
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={singleStock}
                              onChange={(e) =>
                                setSingleStock(Math.max(0, parseInt(e.target.value, 10) || 0))
                              }
                              className={cn(INPUT, "font-bold text-sm tabular-nums")}
                            />
                            {parseInt(addDelta, 10) > 0 && (
                              <p className="text-[11px] text-emerald-700 font-medium">
                                Will save as {singleStock + (parseInt(addDelta, 10) || 0)} in stock
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Unlimited / Out-of-Stock Info State */}
                {((!isVirt && physMode === "unlimited") ||
                  (isVirt && virtMode === "unlimited")) && (
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200/80 text-xs text-gray-600">
                    This product is set to <strong>Unlimited Stock</strong> and can always be
                    ordered by customers.
                  </div>
                )}

                {((!isVirt && physMode === "out_of_stock") ||
                  (isVirt && virtMode === "out_of_stock")) && (
                  <div className="p-4 rounded-xl bg-red-50/70 border border-red-200 text-xs text-red-700">
                    This product will appear as <strong>Out of Stock</strong> in the shop and
                    cannot be purchased until restocked.
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={onClose}
                  className="h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-5 rounded-xl bg-black hover:bg-gray-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  {saving ? "Saving…" : "Save Stock"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
