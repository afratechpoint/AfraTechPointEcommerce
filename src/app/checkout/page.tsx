"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ArrowLeft,
  CreditCard,
  AlertCircle,
  Copy,
  Package,
  Banknote,
  Check,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AdminSelect from "@/components/admin/AdminSelect";
import { useCart } from "@/lib/cart";
import { useSettings } from "@/components/SettingsProvider";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import PremiumLoader from "@/components/PremiumLoader";
import { copyText } from "@/lib/clipboard";
import { useRealtime } from "@/lib/realtime-client";
import { getAvailableStock, type StockableProduct } from "@/lib/inventory";
import { cn } from "@/lib/utils";

const EXACT_11_DIGITS = /^\d{11}$/;

function sanitizePhone11(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8801") && digits.length >= 13) {
    return digits.slice(2, 13);
  }
  return digits.slice(0, 11);
}

type PaymentTab = "digital" | "cod";

export default function CheckoutPage() {
  const { items, clearCart } = useCart();
  const settings = useSettings() as any;
  const { user, loading } = useAuth();
  const router = useRouter();

  const [isProcessing, setIsProcessing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const submitted = useRef(false);

  // Shipping
  const [ship, setShip] = useState({
    fullName: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
    division: "",
    district: "",
    upazila: "",
  });

  // BD Geo data
  const [geoDivisions, setGeoDivisions] = useState<any[]>([]);
  const [geoDistricts, setGeoDistricts] = useState<any[]>([]);
  const [geoUpazilas, setGeoUpazilas] = useState<string[]>([]);

  // Payment
  const [paymentTab, setPaymentTab] = useState<PaymentTab>("digital");
  const [method, setMethod] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [transactionId, setTrxId] = useState("");

  // Digital fulfillment fallback
  const [targetUrl, setTargetUrl] = useState("");
  const [fulfillmentNotes, setFulfillmentNotes] = useState("");

  // Live stock check for items in checkout
  const [catalog, setCatalog] = useState<StockableProduct[]>([]);
  const loadCatalog = useCallback(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setCatalog(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useRealtime("products", loadCatalog);

  const catalogMap = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const stockOutItem = useMemo(() => {
    if (catalog.length === 0) return null;
    for (const item of items) {
      const prod = catalogMap.get(item.id);
      if (!prod) return item;
      const avail = getAvailableStock(prod, item.variantName || null);
      if (avail !== null && (avail <= 0 || item.quantity > avail)) return item;
    }
    return null;
  }, [items, catalog.length, catalogMap]);

  useEffect(() => {
    if (!loading && !user) router.push("/login?redirect=/checkout");
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading && items.length === 0 && !submitted.current) router.push("/shop");
  }, [items, loading, router]);

  useEffect(() => {
    if (user) {
      setShip((s) => ({ ...s, fullName: user.displayName ?? "" }));
      user.getIdToken().then((token) => {
        fetch("/api/profile", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.json())
          .then((data) => {
            if (data && (data.phone || data.address || data.division)) {
              setShip((s) => ({
                ...s,
                phone: sanitizePhone11(data.phone || ""),
                address: data.address || "",
                division: data.division || "",
                district: data.district || "",
                upazila: data.upazila || "",
              }));
            }
          })
          .catch(() => {});
      });
    }
  }, [user]);

  useEffect(() => {
    fetch("/api/geo/divisions")
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) setGeoDivisions(d.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ship.division) {
      setGeoDistricts([]);
      setGeoUpazilas([]);
      return;
    }
    fetch(`/api/geo/division/${ship.division.toLowerCase()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) setGeoDistricts(d.data);
      })
      .catch(() => {});
  }, [ship.division]);

  useEffect(() => {
    if (!ship.district || !geoDistricts.length) {
      setGeoUpazilas([]);
      return;
    }
    const distObj = geoDistricts.find(
      (d: any) => d.district?.toLowerCase() === ship.district.toLowerCase()
    );
    setGeoUpazilas(distObj?.upazilla || []);
  }, [ship.district, geoDistricts]);

  const paymentMethods: { id: string; name: string; accountNumber: string; enabled: boolean }[] =
    (settings?.paymentMethods ?? []).filter((m: any) => m.enabled);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const hasPhysical = items.some((i) => (i.productKind || "physical") === "physical");
  const hasVirtual = items.some((i) => i.productKind === "virtual");
  const hasSocial = items.some((i) => i.virtualType === "social");
  const hasItemCustomAnswers = items.some((i) => (i.customFieldAnswers?.length ?? 0) > 0);
  const needsCheckoutTargetUrl = hasSocial && !hasItemCustomAnswers;
  const codEnabled: boolean = settings?.codEnabled !== false && !hasVirtual;

  useEffect(() => {
    if (paymentMethods.length > 0 && !method) setMethod(paymentMethods[0].name);
    if (hasVirtual) {
      setPaymentTab("digital");
    } else if (paymentMethods.length === 0 && codEnabled) {
      setPaymentTab("cod");
    }
  }, [settings, hasVirtual, codEnabled, paymentMethods.length, method]);

  const deliveryCharge = hasPhysical ? Number(settings?.deliveryCharge) || 0 : 0;
  const grandTotal = subtotal + deliveryCharge;
  const currency = settings?.currencySymbol ?? "৳";
  const isCOD = codEnabled && paymentTab === "cod";

  const selectedMethodObj =
    paymentMethods.find((m) => m.name === method) ?? paymentMethods[0] ?? null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (hasPhysical) {
      if (!ship.fullName.trim()) e.fullName = "Full name is required.";
      if (!EXACT_11_DIGITS.test(ship.phone))
        e.phone = "Phone number must be exactly 11 digits.";
      if (!ship.division) e.division = "Select a division.";
      if (!ship.district) e.district = "Select a district.";
      if (!ship.upazila) e.upazila = "Select an area / upazila.";
    }

    if (needsCheckoutTargetUrl && !targetUrl.trim()) {
      e.targetUrl = "Enter the target page or profile URL.";
    }

    if (!isCOD) {
      if (!EXACT_11_DIGITS.test(senderNumber))
        e.senderNumber = "Number must be exactly 11 digits.";
      if (!transactionId.trim()) e.transactionId = "Transaction ID is required.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const copyNum = async (num: string) => {
    if (!num) return;
    const ok = await copyText(num);
    if (!ok) {
      toast.error("Could not copy automatically. Please copy manually.");
      return;
    }
    setCopied(num);
    toast.success("Number copied");
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitted.current || isProcessing) return;
    if (stockOutItem) {
      toast.error(`"${stockOutItem.name}" is Stock Out.`);
      return;
    }
    if (!validate()) return;
    setIsProcessing(true);

    try {
      const token = await user!.getIdToken();
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user!.uid,
          userEmail: user!.email ?? "",
          items: items.map((i) => ({
            productId: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            image: i.image,
            variantName: i.variantName,
            productKind: i.productKind,
            virtualType: i.virtualType,
          })),
          shippingAddress: {
            fullName: ship.fullName.trim(),
            phone: ship.phone.trim(),
            address: [ship.address.trim(), ship.upazila, ship.district, ship.division]
              .filter(Boolean)
              .join(", "),
            city: ship.district || ship.division,
            postalCode: ship.postalCode || undefined,
            division: ship.division,
            district: ship.district,
            upazila: ship.upazila,
          },
          payment: isCOD
            ? {
                method: "Cash on Delivery",
                senderNumber: "",
                transactionId: "",
                accountUsed: "",
              }
            : {
                method,
                senderNumber: senderNumber.trim(),
                transactionId: transactionId.trim(),
                accountUsed: selectedMethodObj?.accountNumber ?? "",
              },
          customer: {
            name: ship.fullName.trim(),
            email: user!.email ?? "",
            phone: ship.phone.trim(),
            address: [ship.address.trim(), ship.upazila, ship.district, ship.division]
              .filter(Boolean)
              .join(", "),
            city: ship.district || ship.division,
          },
          hasPhysical,
          hasVirtual,
          fulfillment:
            hasSocial || hasItemCustomAnswers
              ? {
                  targetUrl: targetUrl.trim() || undefined,
                  notes: fulfillmentNotes.trim() || undefined,
                  customFields: items.flatMap((i) =>
                    (i.customFieldAnswers || []).map((a) => ({
                      product: i.name,
                      label: a.label,
                      value: a.value,
                    }))
                  ),
                }
              : undefined,
          total: grandTotal,
          totalAmount: grandTotal,
          subtotal,
          deliveryCharge,
          paymentMethod: isCOD ? "Cash on Delivery" : method,
          paymentStatus: isCOD ? "pending_cod" : "pending",
          orderStatus: "pending",
          status: "Pending",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to place order. Please try again.");
      }

      submitted.current = true;
      clearCart();
      router.push(`/checkout/success?orderId=${data.id}`);
    } catch (err: any) {
      const msg = err?.message || "Failed to place order. Please try again.";
      setErrors({ _global: msg });
      toast.error(msg);
      loadCatalog();
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading || !user) {
    return <PremiumLoader />;
  }

  const canSubmit = !stockOutItem && (isCOD ? codEnabled : paymentMethods.length > 0);

  const divisionOptions = [
    { value: "", label: "Select Division" },
    ...geoDivisions.map((d: any) => ({ value: d.division, label: d.division })),
  ];
  const districtOptions = [
    { value: "", label: ship.division ? "Select District" : "Select division first" },
    ...geoDistricts.map((d: any) => ({ value: d.district, label: d.district })),
  ];
  const upazilaOptions = [
    { value: "", label: ship.district ? "Select Upazila / Area" : "Select district first" },
    ...geoUpazilas.map((u: string) => ({ value: u, label: u })),
  ];

  return (
    <div className="flex flex-col min-h-screen bg-white text-gray-900">
      <Navbar searchEnabled={false} />

      <main className="flex-1 w-full max-w-[1800px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 md:py-10">
        <div className="mb-6">
          <Link
            href="/cart"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-black transition-colors mb-2"
          >
            <ArrowLeft size={14} /> Back to Cart
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Checkout</h1>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ── Left Column: Shipping + Payment ── */}
          <div className="lg:col-span-7 space-y-6 min-w-0">
            {/* 1. Shipping Address (Physical items only) */}
            {hasPhysical && (
              <section className="border border-gray-200 rounded-2xl p-4 sm:p-6 bg-white">
                <h2 className="text-base font-bold text-gray-900 mb-4">Shipping Address</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Full Name" error={errors.fullName}>
                    <input
                      value={ship.fullName}
                      onChange={(e) => setShip((s) => ({ ...s, fullName: e.target.value }))}
                      placeholder="Your full name"
                      className={inp(!!errors.fullName)}
                    />
                  </Field>

                  <Field
                    label="Phone Number"
                    hint={`${ship.phone.length}/11`}
                    error={errors.phone}
                  >
                    <input
                      type="tel"
                      inputMode="numeric"
                      minLength={11}
                      maxLength={11}
                      pattern="[0-9]{11}"
                      value={ship.phone}
                      onChange={(e) => {
                        const clean = sanitizePhone11(e.target.value);
                        setShip((s) => ({ ...s, phone: clean }));
                        if (errors.phone && clean.length === 11) {
                          setErrors((prev) => ({ ...prev, phone: "" }));
                        }
                      }}
                      placeholder="01XXXXXXXXX"
                      className={cn(inp(!!errors.phone), "font-mono")}
                    />
                  </Field>

                  <Field label="Division" error={errors.division}>
                    <AdminSelect
                      value={ship.division}
                      onChange={(val) =>
                        setShip((s) => ({ ...s, division: val, district: "", upazila: "" }))
                      }
                      options={divisionOptions}
                      placeholder="Select Division"
                    />
                  </Field>

                  <Field label="District" error={errors.district}>
                    <AdminSelect
                      value={ship.district}
                      onChange={(val) =>
                        setShip((s) => ({ ...s, district: val, upazila: "" }))
                      }
                      options={districtOptions}
                      placeholder="Select District"
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label="Upazila / Area" error={errors.upazila}>
                      <AdminSelect
                        value={ship.upazila}
                        onChange={(val) => setShip((s) => ({ ...s, upazila: val }))}
                        options={upazilaOptions}
                        placeholder="Select Area"
                      />
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field label="House / Road / Village" hint="Optional">
                      <input
                        value={ship.address}
                        onChange={(e) =>
                          setShip((s) => ({ ...s, address: e.target.value.slice(0, 150) }))
                        }
                        placeholder="House no, road, block, or village"
                        maxLength={150}
                        className={inp(false)}
                      />
                    </Field>
                  </div>
                </div>
              </section>
            )}

            {/* 2. Target URL fallback (Social virtual products without custom fields) */}
            {needsCheckoutTargetUrl && (
              <section className="border border-gray-200 rounded-2xl p-4 sm:p-6 bg-white space-y-4">
                <h2 className="text-base font-bold text-gray-900">Delivery Target</h2>

                <Field label="Profile / Page URL" error={errors.targetUrl}>
                  <input
                    type="url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://..."
                    className={inp(!!errors.targetUrl)}
                  />
                </Field>

                <Field label="Note" hint="Optional">
                  <textarea
                    value={fulfillmentNotes}
                    onChange={(e) => setFulfillmentNotes(e.target.value)}
                    rows={2}
                    placeholder="Any extra instructions"
                    className="w-full p-3 rounded-xl bg-white border border-gray-200 outline-none text-sm text-gray-900 resize-none focus:border-black transition-colors"
                  />
                </Field>
              </section>
            )}

            {/* 3. Payment Method */}
            <section className="border border-gray-200 rounded-2xl p-4 sm:p-6 bg-white">
              <h2 className="text-base font-bold text-gray-900 mb-4">Payment Method</h2>

              {/* Digital vs COD Switcher (only when COD is allowed) */}
              {paymentMethods.length > 0 && codEnabled && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-5">
                  <button
                    type="button"
                    onClick={() => setPaymentTab("digital")}
                    className={cn(
                      "h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer",
                      paymentTab === "digital"
                        ? "bg-white text-gray-900 shadow-xs"
                        : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <CreditCard size={14} /> Mobile Banking
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentTab("cod")}
                    className={cn(
                      "h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer",
                      paymentTab === "cod"
                        ? "bg-white text-gray-900 shadow-xs"
                        : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <Banknote size={14} /> Cash on Delivery
                  </button>
                </div>
              )}

              {paymentMethods.length === 0 && !codEnabled && (
                <p className="text-xs text-red-600 font-medium py-2">
                  No payment methods are currently enabled. Please contact support.
                </p>
              )}

              {/* Digital Payment Flow */}
              {paymentTab === "digital" && paymentMethods.length > 0 && (
                <div className="space-y-4">
                  {/* Step 1: Select Provider */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">
                      Select Provider
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {paymentMethods.map((m) => {
                        const active = method === m.name;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMethod(m.name)}
                            className={cn(
                              "h-10 px-3 rounded-xl border text-xs sm:text-sm font-semibold transition-colors truncate cursor-pointer",
                              active
                                ? "bg-black text-white border-black"
                                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                            )}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Step 2: Spacious Full-Width Number Box for Selected Method (Zero Mobile Overflow) */}
                  {selectedMethodObj && (
                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 sm:p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">
                          Send{" "}
                          <span className="font-bold text-gray-900">
                            {currency}
                            {grandTotal.toFixed(2)}
                          </span>{" "}
                          to ({selectedMethodObj.name})
                        </p>
                        <p className="text-base sm:text-lg font-bold font-mono text-gray-900 mt-0.5 break-all">
                          {selectedMethodObj.accountNumber || "—"}
                        </p>
                      </div>

                      {selectedMethodObj.accountNumber && (
                        <button
                          type="button"
                          onClick={() => copyNum(selectedMethodObj.accountNumber)}
                          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-800 hover:border-black hover:text-black shrink-0 transition-colors cursor-pointer"
                        >
                          {copied === selectedMethodObj.accountNumber ? (
                            <>
                              <Check size={13} className="text-emerald-600" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy size={13} /> Copy
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Step 3: Sender Number & TrxID */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label={`Your ${method || "Sender"} Number`}
                      hint={`${senderNumber.length}/11`}
                      error={errors.senderNumber}
                    >
                      <input
                        type="tel"
                        inputMode="numeric"
                        minLength={11}
                        maxLength={11}
                        pattern="[0-9]{11}"
                        value={senderNumber}
                        onChange={(e) => {
                          const clean = sanitizePhone11(e.target.value);
                          setSenderNumber(clean);
                          if (errors.senderNumber && clean.length === 11) {
                            setErrors((prev) => ({ ...prev, senderNumber: "" }));
                          }
                        }}
                        placeholder="01XXXXXXXXX"
                        className={cn(inp(!!errors.senderNumber), "font-mono")}
                      />
                    </Field>

                    <Field label="Transaction ID (TrxID)" error={errors.transactionId}>
                      <input
                        value={transactionId}
                        onChange={(e) => setTrxId(e.target.value)}
                        placeholder="e.g. 9FT9XXXXX"
                        className={cn(inp(!!errors.transactionId), "font-mono")}
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* Cash on Delivery Flow */}
              {paymentTab === "cod" && codEnabled && (
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                  <p className="text-sm font-semibold text-gray-900">Pay on Delivery</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                    No advance payment required. Pay{" "}
                    <span className="font-bold text-gray-900">
                      {currency}
                      {grandTotal.toFixed(2)}
                    </span>{" "}
                    in cash when your package arrives.
                  </p>
                </div>
              )}
            </section>

            {errors._global && (
              <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs sm:text-sm font-medium">
                <AlertCircle size={16} className="shrink-0" /> {errors._global}
              </div>
            )}
          </div>

          {/* ── Right Column: Order Summary ── */}
          <div className="lg:col-span-5 min-w-0">
            <div className="border border-gray-200 rounded-2xl p-4 sm:p-6 bg-white lg:sticky lg:top-20">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">Order Summary</h2>
                <Link
                  href="/cart"
                  className="text-xs font-semibold text-gray-500 hover:text-black transition-colors"
                >
                  Edit Cart
                </Link>
              </div>

              <div className="space-y-3 mb-5 max-h-64 overflow-y-auto pr-1">
                {items.map((item) => {
                  const prod = catalogMap.get(item.id);
                  const avail =
                    catalog.length > 0
                      ? prod
                        ? getAvailableStock(prod, item.variantName || null)
                        : 0
                      : null;
                  const itemOut = avail !== null && avail <= 0;
                  const itemExceeds = avail !== null && avail > 0 && item.quantity > avail;

                  return (
                  <div
                    key={`${item.id}-${item.variantName || "default"}`}
                    className="flex items-center gap-3"
                  >
                    <div className="w-12 h-12 bg-gray-50 rounded-xl shrink-0 overflow-hidden border border-gray-100 flex items-center justify-center">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-contain p-1"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                          {item.name}
                        </p>
                        {itemOut && (
                          <span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase">
                            Stock Out
                          </span>
                        )}
                        {itemExceeds && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold">
                            Only {avail} left
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 truncate">
                        {item.variantName ? `${item.variantName} · ` : ""}Qty {item.quantity}
                      </p>
                    </div>
                    <p className="text-xs sm:text-sm font-bold text-gray-900 tabular-nums shrink-0">
                      {currency}
                      {(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                  );
                })}
              </div>

              {stockOutItem && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-600 font-medium">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>{stockOutItem.name}</strong> is Stock Out. Edit your cart to continue.
                  </span>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 space-y-2 mb-5 text-xs sm:text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {currency}
                    {subtotal.toFixed(2)}
                  </span>
                </div>

                {hasPhysical && (
                  <div className="flex justify-between text-gray-600">
                    <span>Delivery</span>
                    <span className="font-semibold text-gray-900 tabular-nums">
                      {deliveryCharge > 0 ? `${currency}${deliveryCharge.toFixed(2)}` : "Free"}
                    </span>
                  </div>
                )}

                <div className="flex justify-between font-bold text-gray-900 text-base pt-2.5 border-t border-gray-200/80">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {currency}
                    {grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isProcessing || !canSubmit}
                className={cn(
                  "w-full h-11 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2",
                  stockOutItem
                    ? "bg-red-50 text-red-600 border border-red-200 cursor-not-allowed"
                    : "bg-black text-white hover:bg-gray-800 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                )}
              >
                {isProcessing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : stockOutItem ? (
                  "Stock Out"
                ) : (
                  <>
                    <Package size={16} />
                    {isCOD ? "Confirm COD Order" : "Place Order"}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </main>

      <Footer />
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="block text-xs font-semibold text-gray-700 truncate">{label}</label>
        {hint && <span className="text-[11px] text-gray-400 shrink-0">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-red-600 text-[11px] mt-1 font-medium">{error}</p>}
    </div>
  );
}

function inp(err: boolean) {
  return cn(
    "w-full h-10 px-3.5 rounded-xl bg-white border outline-none text-sm text-gray-900 transition-colors min-w-0",
    err ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-black"
  );
}
