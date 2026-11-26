"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Package,
  Receipt,
  Check,
  XCircle,
  Truck,
  Download,
  Copy,
  Eye,
  EyeOff,
  ArrowUpRight,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/components/SettingsProvider";
import PremiumLoader from "@/components/PremiumLoader";
import { useRealtime } from "@/lib/realtime-client";
import { cn } from "@/lib/utils";

interface OrderItem {
  id?: string;
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  variantName?: string;
  productKind?: string;
  virtualType?: string;
}

interface Delivery {
  productId: string;
  type: string;
  value: string;
  password?: string;
  note?: string;
  variantName?: string;
  revealed?: boolean;
}

interface Order {
  id: string;
  createdAt: string;
  total?: number;
  totalAmount?: number;
  subtotal?: number;
  deliveryCharge?: number;
  paymentStatus?: string;
  orderStatus?: string;
  status?: string;
  cancellationReason?: string;
  paymentMethod?: string;
  payment?: {
    method?: string;
    senderNumber?: string;
    transactionId?: string;
    accountUsed?: string;
  };
  paymentDetails?: {
    method?: string;
    senderNumber?: string;
    transactionId?: string;
  };
  shippingAddress?: {
    fullName?: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    email?: string;
  };
  userEmail?: string;
  items: OrderItem[];
  hasPhysical?: boolean;
  fulfillment?: {
    targetUrl?: string;
    notes?: string;
    customFields?: { product?: string; label: string; value: string }[];
  } | null;
  deliveries?: Delivery[];
}

export default function UserOrderDetailPage() {
  const { orderId } = useParams() as { orderId: string };
  const { user, loading } = useAuth();
  const router = useRouter();
  const settings = useSettings() as any;
  const currency = settings?.currencySymbol ?? "৳";

  const [order, setOrder] = useState<Order | null>(null);
  const [fetching, setFetching] = useState(true);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const loadOrder = React.useCallback(
    (silent = false) => {
      if (!orderId || !user) return;
      user
        .getIdToken()
        .then((token) =>
          fetch(`/api/orders/${orderId}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          })
        )
        .then(async (r) => {
          if (!r.ok) return null;
          return r.json();
        })
        .then((data) => {
          if (data) setOrder(data);
          else if (!silent) setOrder(null);
          setFetching(false);
        })
        .catch(() => {
          if (!silent) setOrder(null);
          setFetching(false);
        });
    },
    [orderId, user]
  );

  useEffect(() => {
    loadOrder(false);
  }, [loadOrder]);

  useRealtime("orders", () => loadOrder(true));

  if (loading || fetching) return <PremiumLoader />;

  if (!order?.id) {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        <Navbar searchEnabled={false} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
          <Package size={28} className="text-gray-300" />
          <p className="text-sm font-semibold text-gray-900">Order not found</p>
          <Link href="/account?tab=orders" className="text-xs font-semibold text-black underline">
            Back to Orders
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const payStatus = (order.paymentStatus ?? "pending").toLowerCase();
  const rawOrdStatus = (order.orderStatus ?? order.status ?? "pending").toLowerCase();
  const isRefunded = payStatus === "refunded";
  const isCancelled = rawOrdStatus === "cancelled" || payStatus === "cancelled";

  const ordStatus = rawOrdStatus === "completed" ? "delivered" : rawOrdStatus;

  const total = order.totalAmount ?? order.total ?? 0;
  const subtotal = order.subtotal ?? total;
  const delivery = order.deliveryCharge ?? 0;
  const pmt = order.payment ?? order.paymentDetails ?? {};
  const pmtMethod = pmt.method ?? order.paymentMethod ?? "—";
  const addr = order.shippingAddress;
  const cust = order.customer;
  const isCOD = pmtMethod === "Cash on Delivery";
  const isVirtual =
    order.hasPhysical === false ||
    (Array.isArray(order.items) &&
      order.items.length > 0 &&
      order.items.every((it) => it.productKind === "virtual"));

  const shortOrderId = order.id.slice(0, 10).toUpperCase();
  const itemCount = order.items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0;

  const placedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const placedTime = new Date(order.createdAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const ordStatusLabel = isCancelled
    ? "Cancelled"
    : isVirtual
    ? ordStatus === "delivered"
      ? "Completed"
      : ordStatus === "processing"
      ? "In Progress"
      : "Pending"
    : ordStatus.charAt(0).toUpperCase() + ordStatus.slice(1);

  const payStatusLabel = isRefunded
    ? "Refunded"
    : payStatus === "confirmed"
    ? "Paid"
    : payStatus === "pending_cod"
    ? "Cash on Delivery"
    : payStatus === "failed"
    ? "Payment Rejected"
    : payStatus === "cancelled"
    ? "Cancelled"
    : "Verifying Payment";

  // Segmented Stepper Steps
  const steps = isVirtual
    ? [
        {
          title: "Order Placed",
          desc: `${placedDate} at ${placedTime}`,
          icon: Receipt,
          state:
            ordStatus === "processing" || ordStatus === "delivered"
              ? ("done" as const)
              : ("active" as const),
        },
        {
          title: "In Progress",
          desc:
            ordStatus === "delivered"
              ? "Processed & fulfilled"
              : ordStatus === "processing"
              ? "Working on your order"
              : payStatus === "confirmed"
              ? "Payment verified · Queued"
              : "Awaiting payment verification",
          icon: Clock,
          state:
            ordStatus === "delivered"
              ? ("done" as const)
              : ordStatus === "processing"
              ? ("active" as const)
              : ("upcoming" as const),
        },
        {
          title: "Completed",
          desc:
            ordStatus === "delivered"
              ? "Delivered to your account"
              : "Delivery will appear below",
          icon: Check,
          state: ordStatus === "delivered" ? ("done" as const) : ("upcoming" as const),
        },
      ]
    : [
        {
          title: "Order Placed",
          desc: `${placedDate} at ${placedTime}`,
          icon: Receipt,
          state:
            ordStatus === "shipped" || ordStatus === "delivered"
              ? ("done" as const)
              : ("active" as const),
        },
        {
          title: "Shipped",
          desc:
            ordStatus === "delivered"
              ? "Handed over to courier"
              : ordStatus === "shipped"
              ? "On the way to your address"
              : "Preparing package for dispatch",
          icon: Truck,
          state:
            ordStatus === "delivered"
              ? ("done" as const)
              : ordStatus === "shipped"
              ? ("active" as const)
              : ("upcoming" as const),
        },
        {
          title: "Delivered",
          desc:
            ordStatus === "delivered"
              ? "Package delivered"
              : isCOD
              ? `Pay ${currency}${total.toFixed(2)} on arrival`
              : "Arriving at your address",
          icon: Check,
          state: ordStatus === "delivered" ? ("done" as const) : ("upcoming" as const),
        },
      ];

  const handleCopy = async (text: string, label = "Copied") => {
    const ok = await copyText(text);
    if (ok) toast.success(label);
    else toast.error("Could not copy");
  };

  const hasDeliveries = Array.isArray(order.deliveries) && order.deliveries.length > 0;

  return (
    <div className="flex flex-col min-h-screen bg-white text-gray-900">
      <Navbar searchEnabled={false} />

      <main className="flex-1 w-full max-w-[1800px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 md:py-10">
        {/* ── Back Link ── */}
        <Link
          href="/account?tab=orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-black transition-colors mb-4"
        >
          <ArrowLeft size={14} /> My Orders
        </Link>

        {/* ── Header Bar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-200 mb-6">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                Order #{shortOrderId}
              </h1>
              <button
                onClick={() => handleCopy(order.id, "Order ID copied")}
                title="Copy full Order ID"
                className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-black hover:border-gray-300 transition-colors cursor-pointer"
              >
                <Copy size={13} />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Placed on {placedDate} at {placedTime} · {itemCount} item{itemCount !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-semibold border",
                isRefunded
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : payStatus === "confirmed"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : payStatus === "failed" || payStatus === "cancelled"
                  ? "bg-red-50 text-red-600 border-red-200"
                  : payStatus === "pending_cod"
                  ? "bg-gray-100 text-gray-700 border-gray-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              )}
            >
              {payStatusLabel}
            </span>
            <span
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-semibold border",
                isCancelled
                  ? "bg-red-50 text-red-600 border-red-200"
                  : ordStatus === "delivered"
                  ? "bg-black text-white border-black"
                  : "bg-gray-100 text-gray-900 border-gray-200"
              )}
            >
              {ordStatusLabel}
            </span>
          </div>
        </div>

        {/* ── Refunded / Cancelled Alerts OR Clean 3-Column Segmented Progress ── */}
        {(isRefunded || isCancelled) && (
          <div className="space-y-3 mb-6">
            {isRefunded && (
              <div className="border border-blue-200 bg-blue-50/70 rounded-2xl p-4 flex items-start gap-3">
                <RotateCcw size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">Payment Refunded</p>
                  <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
                    Your payment of{" "}
                    <strong>
                      {currency}
                      {total.toFixed(2)}
                    </strong>
                    {pmtMethod && pmtMethod !== "—" ? ` via ${pmtMethod}` : ""} has been refunded.
                  </p>
                </div>
              </div>
            )}

            {isCancelled && (
              <div className="border border-red-200 bg-red-50/70 rounded-2xl p-4 flex items-start gap-3">
                <XCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-800">Order Cancelled</p>
                  {order.cancellationReason ? (
                    <p className="text-xs sm:text-sm text-red-700 mt-1 leading-relaxed break-words">
                      <span className="font-semibold">Reason:</span> {order.cancellationReason}
                    </p>
                  ) : (
                    <p className="text-xs text-red-600 mt-0.5">
                      {payStatus === "failed"
                        ? "Payment could not be verified. Contact support if you need assistance."
                        : "This order was cancelled."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!isCancelled && !isRefunded && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {steps.map((step, idx) => {
              const isDone = step.state === "done";
              const isActive = step.state === "active";
              return (
                <div
                  key={step.title}
                  className={cn(
                    "rounded-2xl border p-4 transition-colors",
                    isDone || isActive
                      ? "border-gray-200 bg-white"
                      : "border-gray-100 bg-gray-50/60"
                  )}
                >
                  {/* Top progress bar */}
                  <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden mb-3.5">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        isDone
                          ? "w-full bg-black"
                          : isActive
                          ? "w-1/2 bg-black"
                          : "w-0 bg-transparent"
                      )}
                    />
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0",
                        isDone
                          ? "bg-black text-white"
                          : isActive
                          ? "border-2 border-black text-black bg-white"
                          : "bg-gray-200/70 text-gray-500"
                      )}
                    >
                      {isDone ? <Check size={12} strokeWidth={3} /> : idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-xs sm:text-sm font-semibold truncate",
                          isDone || isActive ? "text-gray-900" : "text-gray-400"
                        )}
                      >
                        {step.title}
                      </p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Main Content Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* 1. Digital Delivery Card (Virtual Orders) */}
            {isVirtual && !isCancelled && !isRefunded && (
              <>
                {hasDeliveries && payStatus === "confirmed" ? (
                  <div className="border border-black rounded-2xl overflow-hidden bg-white">
                    <div className="px-5 py-3.5 bg-black text-white flex items-center justify-between">
                      <h2 className="text-xs sm:text-sm font-semibold">Your Delivery</h2>
                      <span className="text-[11px] text-gray-300">Ready to use</span>
                    </div>

                    <div className="p-5 space-y-4 divide-y divide-gray-100">
                      {order.deliveries!.map((d, i) => {
                        const showPass = !!visiblePasswords[i];
                        return (
                          <div key={i} className={cn("space-y-3", i > 0 && "pt-4")}>
                            {d.variantName && (
                              <span className="inline-block px-2.5 py-0.5 rounded-md bg-gray-100 text-xs font-semibold text-gray-800">
                                {d.variantName}
                              </span>
                            )}

                            {/* Primary Value (Email/Username, Key, Link, or Social Note) */}
                            {d.value && (
                              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-gray-50 border border-gray-200/80">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-gray-500 mb-0.5">
                                    {d.type === "account"
                                      ? "Account ID / Email"
                                      : d.type === "license"
                                      ? "License Key"
                                      : d.type === "software"
                                      ? "Download Link"
                                      : "Service Update"}
                                  </p>
                                  <p className="text-sm font-bold text-gray-900 font-mono break-all">
                                    {d.value}
                                  </p>
                                </div>

                                {d.type !== "social" && (
                                  <button
                                    onClick={() => handleCopy(d.value, "Copied to clipboard")}
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-black hover:text-black shrink-0 transition-colors cursor-pointer"
                                  >
                                    <Copy size={12} /> Copy
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Password (for Accounts) */}
                            {d.password && (
                              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-gray-50 border border-gray-200/80">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-gray-500 mb-0.5">
                                    Password
                                  </p>
                                  <p className="text-sm font-bold text-gray-900 font-mono break-all">
                                    {showPass ? d.password : "••••••••••••"}
                                  </p>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() =>
                                      setVisiblePasswords((prev) => ({
                                        ...prev,
                                        [i]: !prev[i],
                                      }))
                                    }
                                    title={showPass ? "Hide password" : "Show password"}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-black hover:text-black transition-colors cursor-pointer"
                                  >
                                    {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleCopy(d.password || "", "Password copied")
                                    }
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-black hover:text-black transition-colors cursor-pointer"
                                  >
                                    <Copy size={12} /> Copy
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Software Download CTA */}
                            {d.type === "software" && /^https?:\/\//i.test(d.value) && (
                              <a
                                href={d.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
                              >
                                <Download size={13} /> Open Download
                              </a>
                            )}

                            {d.note && (
                              <p className="text-xs text-gray-600 leading-relaxed">{d.note}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-2xl p-4 sm:p-5 bg-gray-50/50 flex items-start gap-3">
                    <Clock size={16} className="text-gray-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {payStatus === "confirmed"
                          ? "Preparing your digital delivery"
                          : "Waiting for payment verification"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                        {payStatus === "confirmed"
                          ? "Your payment is confirmed. Your account credentials, key, or service update will appear right here automatically."
                          : "Once our team confirms your transaction, your order will be fulfilled here automatically."}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 2. Order Items Card */}
            <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900">Items Ordered</h2>
                <span className="text-xs text-gray-500">
                  {itemCount} item{itemCount !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="divide-y divide-gray-100">
                {order.items?.map((item, i) => {
                  const targetProdId = item.productId || item.id;
                  return (
                    <div key={i} className="flex items-center gap-4 p-4 sm:px-5">
                      <div className="w-16 h-16 rounded-xl bg-gray-50 border border-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          <Package size={20} className="text-gray-300" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {targetProdId ? (
                          <Link
                            href={`/shop/${targetProdId}`}
                            className="text-sm font-semibold text-gray-900 hover:underline truncate inline-flex items-center gap-1 max-w-full"
                          >
                            <span className="truncate">{item.name}</span>
                          </Link>
                        ) : (
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {item.name}
                          </p>
                        )}

                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          {item.variantName && (
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-medium text-gray-700">
                              {item.variantName}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 tabular-nums">
                            {currency}
                            {item.price.toFixed(2)} × {item.quantity}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm sm:text-base font-bold text-gray-900 tabular-nums shrink-0">
                        {currency}
                        {(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Price Summary Footer */}
              <div className="px-5 py-4 bg-gray-50/60 border-t border-gray-100 space-y-2">
                <div className="flex justify-between text-xs sm:text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-medium text-gray-900 tabular-nums">
                    {currency}
                    {subtotal.toFixed(2)}
                  </span>
                </div>

                {!isVirtual && (
                  <div className="flex justify-between text-xs sm:text-sm text-gray-600">
                    <span>Delivery Charge</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      {delivery === 0 ? "Free" : `${currency}${delivery.toFixed(2)}`}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm sm:text-base font-bold text-gray-900 pt-2.5 border-t border-gray-200/80">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {currency}
                    {total.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Customer Submitted Info (Virtual Custom Fields / Target URL) */}
            {(order.fulfillment?.targetUrl ||
              (order.fulfillment?.customFields && order.fulfillment.customFields.length > 0) ||
              order.fulfillment?.notes) && (
              <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900">Submitted Details</h2>
                </div>
                <div className="p-5 space-y-3 text-xs sm:text-sm">
                  {order.fulfillment?.targetUrl && (
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-4">
                      <span className="text-gray-500 shrink-0">Target Link</span>
                      <a
                        href={order.fulfillment.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-900 underline break-all sm:text-right"
                      >
                        {order.fulfillment.targetUrl}
                      </a>
                    </div>
                  )}
                  {order.fulfillment?.customFields?.map((f, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-4"
                    >
                      <span className="text-gray-500 shrink-0">{f.label}</span>
                      <span className="font-semibold text-gray-900 break-all sm:text-right">
                        {f.value}
                      </span>
                    </div>
                  ))}
                  {order.fulfillment?.notes && (
                    <div className="pt-2 border-t border-gray-100">
                      <span className="text-gray-500 block mb-1">Note</span>
                      <p className="text-gray-800">{order.fulfillment.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Payment Summary */}
            <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900">Payment Summary</h2>
              </div>

              <div className="p-5 space-y-3 text-xs sm:text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Method</span>
                  <span className="font-semibold text-gray-900">{pmtMethod}</span>
                </div>

                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Status</span>
                  <span
                    className={cn(
                      "font-semibold",
                      isRefunded
                        ? "text-blue-700"
                        : payStatus === "confirmed"
                        ? "text-emerald-700"
                        : payStatus === "cancelled" || payStatus === "failed"
                        ? "text-red-600"
                        : "text-gray-900"
                    )}
                  >
                    {payStatusLabel}
                  </span>
                </div>

                {!isCOD && pmt.senderNumber && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Sender</span>
                    <span className="font-mono font-semibold text-gray-900">
                      {pmt.senderNumber}
                    </span>
                  </div>
                )}

                {!isCOD && pmt.transactionId && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500 shrink-0">TrxID</span>
                    <button
                      onClick={() => handleCopy(pmt.transactionId || "", "TrxID copied")}
                      className="inline-flex items-center gap-1.5 font-mono font-semibold text-gray-900 hover:text-black break-all text-right cursor-pointer"
                      title="Copy Transaction ID"
                    >
                      <span>{pmt.transactionId}</span>
                      <Copy size={12} className="text-gray-400 shrink-0" />
                    </button>
                  </div>
                )}

                <div className="flex justify-between gap-3 pt-3 border-t border-gray-100">
                  <span className="font-semibold text-gray-900">
                    {isRefunded
                      ? "Amount Refunded"
                      : isCOD && ordStatus !== "delivered"
                      ? "Amount Due"
                      : "Amount Paid"}
                  </span>
                  <span
                    className={cn(
                      "font-bold tabular-nums",
                      isRefunded ? "text-blue-700" : "text-gray-900"
                    )}
                  >
                    {currency}
                    {total.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Shipping Address (Physical Only) */}
            {!isVirtual && (
              <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900">Shipping Address</h2>
                </div>
                <div className="p-5 space-y-1.5 text-xs sm:text-sm">
                  <p className="font-semibold text-gray-900">
                    {addr?.fullName ?? cust?.name ?? "—"}
                  </p>
                  <p className="text-gray-600">{addr?.phone ?? cust?.phone ?? "—"}</p>
                  <p className="text-gray-600 leading-relaxed">
                    {[addr?.address ?? cust?.address, addr?.city ?? cust?.city, addr?.postalCode]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                </div>
              </div>
            )}

            {/* Compact Help Card */}
            <div className="border border-gray-200 rounded-2xl p-4 sm:px-5 bg-gray-50/50 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-900">Need help with this order?</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Share Order #{shortOrderId} with support.
                </p>
              </div>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-800 hover:border-black hover:text-black shrink-0 transition-colors"
              >
                Support <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
