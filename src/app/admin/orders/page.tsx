"use client";

import React, { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useSettings } from "@/components/SettingsProvider";
import DeleteConfirmModal from "@/components/admin/DeleteConfirmModal";
import VirtualOrderFulfillPanel from "@/components/admin/VirtualOrderFulfillPanel";
import {
  Search,
  ChevronRight,
  XCircle,
  Trash2,
  Banknote,
  Download,
  Printer,
  FileText,
  ShoppingBag,
  X,
  Package,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PremiumLoader from "@/components/PremiumLoader";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-helper";
import OrderInvoice from "@/components/admin/OrderInvoice";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { subscribeToAllOrders } from "@/lib/firebase/firestore";

interface OrderItem {
  name?: string;
  quantity?: number;
  price?: number;
  variantName?: string;
  productKind?: "physical" | "virtual";
  virtualType?: "social" | "account" | "license" | "software";
}

interface Order {
  id: string;
  createdAt: any;
  total?: number;
  totalAmount?: number;
  paymentStatus?: string;
  orderStatus?: string;
  status?: string;
  userEmail?: string;
  hasPhysical?: boolean;
  hasVirtual?: boolean;
  payment?: { method?: string; transactionId?: string; senderNumber?: string };
  paymentDetails?: { method?: string; transactionId?: string; senderNumber?: string };
  shippingAddress?: { fullName?: string; phone?: string };
  customer?: { name?: string; phone?: string; email?: string };
  items: OrderItem[];
}

type OrderSection = "physical" | "virtual";
type OrderBucket = "active" | "completed" | "cancelled" | "refunded";

function isVirtualOrder(order: Order): boolean {
  if (order.hasPhysical === false) return true;
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.every((i) => i.productKind === "virtual");
  }
  return false;
}

function getNormalizedOrderStatus(order: Order): string {
  const raw = (order.orderStatus ?? order.status ?? "pending").toLowerCase();
  return raw === "completed" ? "delivered" : raw;
}

function getNormalizedPaymentStatus(order: Order): string {
  const raw = (order.paymentStatus ?? "pending").toLowerCase();
  // Treat any legacy "failed" status as cancelled
  return raw === "failed" ? "cancelled" : raw;
}

function getOrderBucket(order: Order): OrderBucket {
  const payStatus = getNormalizedPaymentStatus(order);
  const ordStatus = getNormalizedOrderStatus(order);

  if (payStatus === "refunded") return "refunded";
  if (ordStatus === "cancelled" || payStatus === "cancelled") return "cancelled";
  if (ordStatus === "delivered") return "completed";
  return "active";
}

const PHYSICAL_PMT_OPTIONS = [
  { value: "pending", label: "Pending", color: "#b45309", bg: "#fffbeb", border: "#fde68a", dot: "#f59e0b" },
  { value: "pending_cod", label: "Cash on Delivery", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe", dot: "#3b82f6" },
  { value: "confirmed", label: "Confirmed", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" },
  { value: "refunded", label: "Refunded", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", dot: "#60a5fa" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" },
];

const VIRTUAL_PMT_OPTIONS = PHYSICAL_PMT_OPTIONS.filter((o) => o.value !== "pending_cod");

const PHYSICAL_ORD_OPTIONS = [
  { value: "pending", label: "Pending", color: "#4b5563", bg: "#f9fafb", border: "#e5e7eb", dot: "#9ca3af" },
  { value: "processing", label: "Processing", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe", dot: "#3b82f6" },
  { value: "shipped", label: "Shipped", color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe", dot: "#8b5cf6" },
  { value: "delivered", label: "Delivered", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" },
];

const VIRTUAL_ORD_OPTIONS = [
  { value: "pending", label: "Pending", color: "#b45309", bg: "#fffbeb", border: "#fde68a", dot: "#f59e0b" },
  { value: "processing", label: "In Progress", color: "#111827", bg: "#f3f4f6", border: "#e5e7eb", dot: "#111827" },
  { value: "delivered", label: "Completed", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" },
];

const BUCKET_TABS: { id: OrderBucket; label: string }[] = [
  { id: "active", label: "Active (Pending & Processing)" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "refunded", label: "Refunded" },
];

function StatusBadge({
  value,
  options,
}: {
  value: string;
  options: typeof PHYSICAL_PMT_OPTIONS;
}) {
  const cfg = options.find((o) => o.value === value) ?? options[0];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border"
      style={{ backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function formatOrderDate(raw: any): string {
  if (!raw) return "—";
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function AdminOrdersContent() {
  const settings = useSettings() as any;
  const currency = settings?.currencySymbol ?? "৳";
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialSection: OrderSection =
    searchParams.get("section") === "virtual" ? "virtual" : "physical";

  const [section, setSection] = useState<OrderSection>(initialSection);
  const [bucket, setBucket] = useState<OrderBucket>("active");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");

  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; orderId: string }>({
    isOpen: false,
    orderId: "",
  });
  const [deleting, setDeleting] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [fulfillOrder, setFulfillOrder] = useState<Order | null>(null);

  useEffect(() => {
    const paramSec = searchParams.get("section");
    if (paramSec === "virtual" || paramSec === "physical") {
      setSection(paramSec);
    }
  }, [searchParams]);

  const switchSection = (next: OrderSection) => {
    setSection(next);
    router.replace(`/admin/orders?section=${next}`, { scroll: false });
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAllOrders((data) => {
      setOrders(data as any);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const { physicalOrders, virtualOrders } = useMemo(() => {
    const physical: Order[] = [];
    const virtual: Order[] = [];
    for (const o of orders) {
      if (isVirtualOrder(o)) virtual.push(o);
      else physical.push(o);
    }
    return { physicalOrders: physical, virtualOrders: virtual };
  }, [orders]);

  const activeBaseOrders = section === "virtual" ? virtualOrders : physicalOrders;

  const bucketCounts = useMemo(() => {
    const counts: Record<OrderBucket, number> = {
      active: 0,
      completed: 0,
      cancelled: 0,
      refunded: 0,
    };
    for (const o of activeBaseOrders) {
      counts[getOrderBucket(o)]++;
    }
    return counts;
  }, [activeBaseOrders]);

  const filtered = useMemo(() => {
    return activeBaseOrders.filter((o) => {
      if (getOrderBucket(o) !== bucket) return false;

      const name = o.shippingAddress?.fullName ?? o.customer?.name ?? o.userEmail ?? "";
      const phone = o.shippingAddress?.phone ?? o.customer?.phone ?? "";
      const trx = o.payment?.transactionId ?? o.paymentDetails?.transactionId ?? "";
      const itemNames = (o.items || []).map((i) => i.name || "").join(" ");
      const q = search.trim().toLowerCase();
      if (!q) return true;

      return (
        name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        trx.toLowerCase().includes(q) ||
        itemNames.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.userEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [activeBaseOrders, bucket, search]);

  const handleDelete = (orderId: string) => {
    setDeleteModal({ isOpen: true, orderId });
  };

  const confirmDelete = async () => {
    const orderId = deleteModal.orderId;
    if (!orderId) return;

    setDeleting(true);
    try {
      const res = await authenticatedFetch(`/api/orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      showToast("Order deleted successfully.");
      setDeleteModal({ isOpen: false, orderId: "" });
    } catch {
      showToast("Failed to delete order.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDownloadPDF = async (order: Order) => {
    const invoiceElement = document.getElementById("invoice-capture");
    if (!invoiceElement) {
      showToast("Invoice element not found.");
      return;
    }

    try {
      setDownloadingPdf(true);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.width = "148mm";
      iframe.style.height = "210mm";
      iframe.style.left = "-9999px";
      iframe.style.top = "-9999px";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error("Could not create isolated print environment.");

      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"/><title>Invoice</title></head>
          <body style="margin:0; padding:0; background:#fff;">${invoiceElement.innerHTML}</body>
        </html>
      `);
      doc.close();

      if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
      await new Promise((r) => setTimeout(r, 600));

      const targetEl = (doc.querySelector(".inv-wrapper") as HTMLElement) || doc.body;
      const canvas = await html2canvas(targetEl, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const pdf = new jsPDF("p", "mm", "a5");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(dataUrl, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
      pdf.save(`afra-invoice-${order.id.toUpperCase()}.pdf`);
      showToast("Invoice downloaded successfully.");
      document.body.removeChild(iframe);
    } catch {
      showToast("Download failed. Could not render PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrint = () => {
    const invoiceElement = document.getElementById("invoice-capture");
    if (!invoiceElement) return;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>Invoice - ${selectedOrder?.id?.toUpperCase() || ""}</title>
          <style>
            @media print {
              @page { size: A5 portrait; margin: 0; }
              body { margin: 0.5cm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body style="margin:0; background:#fff;">${invoiceElement.innerHTML}</body>
      </html>
    `);
    doc.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
  };

  const activePhysicalCount = physicalOrders.filter((o) => getOrderBucket(o) === "active").length;
  const activeVirtualCount = virtualOrders.filter((o) => getOrderBucket(o) === "active").length;

  const emptyLabel =
    bucket === "active"
      ? `No active ${section} orders`
      : bucket === "completed"
      ? `No completed ${section} orders`
      : bucket === "cancelled"
      ? `No cancelled ${section} orders`
      : `No refunded ${section} orders`;

  const emptySub =
    bucket === "active"
      ? "Pending and processing orders will appear here."
      : bucket === "completed"
      ? "Completed orders are archived in this section."
      : bucket === "cancelled"
      ? "Cancelled orders will appear in this section."
      : "Refunded orders will appear in this section.";

  return (
    <div className="space-y-4 pb-10 w-full">
      {/* ── Two Dedicated Order Sections Switcher ────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Physical Orders Section Card */}
        <button
          type="button"
          onClick={() => switchSection("physical")}
          className={cn(
            "flex items-center justify-between p-4 rounded-2xl border text-left transition-all cursor-pointer",
            section === "physical"
              ? "bg-gray-950 border-gray-950 text-white shadow-sm"
              : "bg-white border-gray-200/80 text-gray-800 hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                section === "physical" ? "bg-white/15 text-white" : "bg-gray-100 text-gray-700"
              )}
            >
              <Package size={19} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold truncate">Physical Orders</span>
                {activePhysicalCount > 0 && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold",
                      section === "physical"
                        ? "bg-amber-400 text-gray-950"
                        : "bg-amber-100 text-amber-800"
                    )}
                  >
                    {activePhysicalCount} active
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "text-xs truncate mt-0.5",
                  section === "physical" ? "text-gray-300" : "text-gray-400"
                )}
              >
                Gadgets, courier shipping & COD
              </p>
            </div>
          </div>

          <span
            className={cn(
              "text-lg font-black tabular-nums pl-3",
              section === "physical" ? "text-white" : "text-gray-900"
            )}
          >
            {activePhysicalCount}
          </span>
        </button>

        {/* Virtual Orders Section Card */}
        <button
          type="button"
          onClick={() => switchSection("virtual")}
          className={cn(
            "flex items-center justify-between p-4 rounded-2xl border text-left transition-all cursor-pointer",
            section === "virtual"
              ? "bg-gray-950 border-gray-950 text-white shadow-sm"
              : "bg-white border-gray-200/80 text-gray-800 hover:border-gray-300"
          )}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                section === "virtual" ? "bg-white/15 text-white" : "bg-gray-100 text-gray-700"
              )}
            >
              <Zap size={19} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold truncate">Virtual Orders</span>
                {activeVirtualCount > 0 && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold",
                      section === "virtual"
                        ? "bg-amber-400 text-gray-950"
                        : "bg-amber-100 text-amber-800"
                    )}
                  >
                    {activeVirtualCount} active
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "text-xs truncate mt-0.5",
                  section === "virtual" ? "text-gray-300" : "text-gray-400"
                )}
              >
                Social growth, accounts, keys & software
              </p>
            </div>
          </div>

          <span
            className={cn(
              "text-lg font-black tabular-nums pl-3",
              section === "virtual" ? "text-white" : "text-gray-900"
            )}
          >
            {activeVirtualCount}
          </span>
        </button>
      </div>

      {/* ── Status Bucket Sections (Active / Completed / Cancelled / Refunded) ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {BUCKET_TABS.map((tabItem) => {
          const isActive = bucket === tabItem.id;
          const count = bucketCounts[tabItem.id];
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setBucket(tabItem.id)}
              className={cn(
                "h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap border transition-colors cursor-pointer shrink-0",
                isActive
                  ? "bg-gray-950 border-gray-950 text-white"
                  : "bg-white border-gray-200/80 text-gray-600 hover:border-gray-300 hover:text-gray-900"
              )}
            >
              <span>{tabItem.label}</span>
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tabular-nums",
                  isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Single-Row Search & Filter Bar ───────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              section === "virtual"
                ? "Search by service name, buyer email, TrxID, or order ID…"
                : "Search by customer name, phone, email, or order ID…"
            }
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-gray-50 border border-gray-200/80 focus:bg-white focus:border-black focus:ring-2 focus:ring-black/5 outline-none text-sm text-gray-900 placeholder:text-gray-400 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="hidden md:flex items-center px-2 text-xs font-medium text-gray-400 whitespace-nowrap shrink-0">
          {filtered.length} {filtered.length === 1 ? "order" : "orders"}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          SECTION 1: PHYSICAL ORDERS GRID TABLE & MOBILE CARDS
         ════════════════════════════════════════════════════════════ */}
      {section === "physical" && (
        <>
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200/80 overflow-hidden w-full">
            <div className="grid grid-cols-[92px_minmax(0,1.2fr)_120px_106px_106px_156px] xl:grid-cols-[120px_minmax(0,1.5fr)_150px_130px_130px_164px] items-center gap-3 px-4 py-3 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500">
              <div>Order</div>
              <div>Customer</div>
              <div>Amount</div>
              <div>Payment</div>
              <div>Shipping</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-100">
              {loading ? (
                <div className="px-6 py-16 text-center">
                  <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin mx-auto" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <div className="w-11 h-11 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-400">
                    <ShoppingBag size={18} />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">{emptyLabel}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{emptySub}</p>
                </div>
              ) : (
                filtered.map((order) => {
                  const payStatus = getNormalizedPaymentStatus(order);
                  const ordStatus = getNormalizedOrderStatus(order);
                  const total = order.totalAmount ?? order.total ?? 0;
                  const pmtMethod = order.payment?.method ?? order.paymentDetails?.method ?? "—";
                  const custName =
                    order.shippingAddress?.fullName ?? order.customer?.name ?? order.userEmail ?? "—";
                  const custSub =
                    order.shippingAddress?.phone ?? order.customer?.phone ?? order.userEmail ?? "—";
                  const itemCount = Array.isArray(order.items)
                    ? order.items.reduce((s, it) => s + (it.quantity || 1), 0)
                    : 0;
                  const isActiveOrder = getOrderBucket(order) === "active";

                  return (
                    <div
                      key={order.id}
                      className="grid grid-cols-[92px_minmax(0,1.2fr)_120px_106px_106px_156px] xl:grid-cols-[120px_minmax(0,1.5fr)_150px_130px_130px_164px] items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-bold text-xs text-gray-900 font-mono hover:underline block truncate"
                        >
                          #{order.id.slice(0, 8).toUpperCase()}
                        </Link>
                        <span className="text-[11px] text-gray-400 block mt-0.5 truncate">
                          {formatOrderDate(order.createdAt)}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">{custName}</p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{custSub}</p>
                      </div>

                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 truncate">
                          {currency}
                          {Number(total).toFixed(2)}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5 truncate">
                          {pmtMethod === "Cash on Delivery" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                              <Banknote size={11} /> COD
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-500 truncate">{pmtMethod}</span>
                          )}
                          {itemCount > 0 && (
                            <span className="text-[10px] text-gray-400 shrink-0">
                              · {itemCount}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <StatusBadge value={payStatus} options={PHYSICAL_PMT_OPTIONS} />
                      </div>

                      <div className="min-w-0">
                        <StatusBadge value={ordStatus} options={PHYSICAL_ORD_OPTIONS} />
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOrder(order);
                            setShowInvoice(true);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
                          title="Invoice Preview"
                        >
                          <FileText size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                          title="Delete Order"
                        >
                          <Trash2 size={14} />
                        </button>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className={cn(
                            "h-8 px-2.5 inline-flex items-center gap-0.5 rounded-lg text-xs font-semibold transition-colors shrink-0",
                            isActiveOrder
                              ? "bg-gray-950 hover:bg-gray-800 text-white"
                              : "border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
                          )}
                        >
                          {isActiveOrder ? "Manage" : "View"} <ChevronRight size={13} />
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Mobile Physical Cards */}
          <div className="md:hidden space-y-3">
            {loading ? (
              <PremiumLoader />
            ) : filtered.length === 0 ? (
              <div className="bg-white p-10 rounded-2xl border border-gray-200/80 text-center">
                <p className="text-sm font-semibold text-gray-700">{emptyLabel}</p>
                <p className="text-xs text-gray-400 mt-0.5">{emptySub}</p>
              </div>
            ) : (
              filtered.map((order) => {
                const payStatus = getNormalizedPaymentStatus(order);
                const ordStatus = getNormalizedOrderStatus(order);
                const total = order.totalAmount ?? order.total ?? 0;
                const pmtMethod = order.payment?.method ?? order.paymentDetails?.method ?? "—";
                const custName =
                  order.shippingAddress?.fullName ?? order.customer?.name ?? order.userEmail ?? "—";
                const custPhone =
                  order.shippingAddress?.phone ?? order.customer?.phone ?? order.userEmail ?? "—";
                const isActiveOrder = getOrderBucket(order) === "active";

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl border border-gray-200/80 p-4 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-xs text-gray-900 font-mono">
                          #{order.id.slice(0, 8).toUpperCase()}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {formatOrderDate(order.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-gray-900">
                          {currency}
                          {Number(total).toFixed(2)}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{pmtMethod}</p>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                      <p className="font-semibold text-sm text-gray-900 truncate">{custName}</p>
                      <p className="text-[11px] text-gray-400 truncate">{custPhone}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 mb-1">Payment</p>
                        <StatusBadge value={payStatus} options={PHYSICAL_PMT_OPTIONS} />
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold text-gray-400 mb-1">Shipping</p>
                        <StatusBadge value={ordStatus} options={PHYSICAL_ORD_OPTIONS} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOrder(order);
                            setShowInvoice(true);
                          }}
                          className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileText size={13} /> Invoice
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id)}
                          className="w-8 h-8 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className={cn(
                          "h-8 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1",
                          isActiveOrder
                            ? "bg-gray-950 text-white"
                            : "border border-gray-200 bg-white text-gray-700"
                        )}
                      >
                        {isActiveOrder ? "Manage" : "View"} <ChevronRight size={13} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          SECTION 2: VIRTUAL ORDERS GRID TABLE & MOBILE CARDS
         ════════════════════════════════════════════════════════════ */}
      {section === "virtual" && (
        <>
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200/80 overflow-hidden w-full">
            <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(0,1.15fr)_124px_98px_146px] xl:grid-cols-[120px_minmax(0,1.2fr)_minmax(0,1.3fr)_155px_120px_156px] items-center gap-3 px-4 py-3 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500">
              <div>Order</div>
              <div>Item</div>
              <div>Buyer</div>
              <div>Payment</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-100">
              {loading ? (
                <div className="px-6 py-16 text-center">
                  <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin mx-auto" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <div className="w-11 h-11 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-400">
                    <Zap size={18} />
                  </div>
                  <p className="text-sm font-semibold text-gray-800">{emptyLabel}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{emptySub}</p>
                </div>
              ) : (
                filtered.map((order) => {
                  const payStatus = getNormalizedPaymentStatus(order);
                  const ordStatus = getNormalizedOrderStatus(order);
                  const total = order.totalAmount ?? order.total ?? 0;
                  const pmt = order.payment ?? order.paymentDetails ?? {};
                  const pmtMethod = pmt.method ?? "—";
                  const trxId = pmt.transactionId ?? "";
                  const firstItem = order.items?.[0];
                  const showVariant =
                    firstItem?.variantName &&
                    firstItem.variantName.trim().toLowerCase() !==
                      (firstItem.name || "").trim().toLowerCase();
                  const buyerEmail = order.userEmail ?? order.customer?.email ?? "—";
                  const buyerName =
                    order.customer?.name ||
                    order.shippingAddress?.fullName ||
                    buyerEmail.split("@")[0];
                  const isActiveOrder = getOrderBucket(order) === "active";

                  const combinedStatus =
                    payStatus === "refunded"
                      ? { label: "Refunded", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", dot: "#60a5fa" }
                      : ordStatus === "cancelled" || payStatus === "cancelled"
                      ? { label: "Cancelled", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" }
                      : ordStatus === "delivered"
                      ? { label: "Completed", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" }
                      : ordStatus === "processing"
                      ? { label: "In Progress", color: "#111827", bg: "#f3f4f6", border: "#e5e7eb", dot: "#111827" }
                      : { label: "Pending", color: "#b45309", bg: "#fffbeb", border: "#fde68a", dot: "#f59e0b" };

                  return (
                    <div
                      key={order.id}
                      className="grid grid-cols-[90px_minmax(0,1fr)_minmax(0,1.15fr)_124px_98px_146px] xl:grid-cols-[120px_minmax(0,1.2fr)_minmax(0,1.3fr)_155px_120px_156px] items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-bold text-xs text-gray-900 font-mono hover:underline block truncate"
                        >
                          #{order.id.slice(0, 8).toUpperCase()}
                        </Link>
                        <span className="text-[11px] text-gray-400 block mt-0.5 truncate">
                          {formatOrderDate(order.createdAt)}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">
                          {firstItem?.name || "Virtual Item"}
                          {order.items?.length > 1 ? ` (+${order.items.length - 1})` : ""}
                        </p>
                        {showVariant && (
                          <p className="text-[11px] text-gray-400 truncate mt-0.5">
                            {firstItem?.variantName}
                          </p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">{buyerName}</p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{buyerEmail}</p>
                      </div>

                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 truncate">
                          {currency}
                          {Number(total).toFixed(2)}{" "}
                          <span className="text-[11px] font-medium text-gray-500">· {pmtMethod}</span>
                        </p>
                        {trxId ? (
                          <p className="text-[11px] font-mono text-gray-400 mt-0.5 truncate">
                            Trx: {trxId}
                          </p>
                        ) : (
                          <p className="text-[11px] text-gray-400 mt-0.5">No TrxID</p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border"
                          style={{
                            backgroundColor: combinedStatus.bg,
                            color: combinedStatus.color,
                            borderColor: combinedStatus.border,
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: combinedStatus.dot }}
                          />
                          {combinedStatus.label}
                        </span>
                      </div>

                      {/* Actions: Confirm button ONLY shown on active (pending/processing) orders */}
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                          title="Delete Order"
                        >
                          <Trash2 size={14} />
                        </button>
                        {isActiveOrder ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setFulfillOrder(order)}
                              className="h-8 px-2.5 inline-flex items-center justify-center rounded-lg bg-gray-950 hover:bg-gray-800 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                            >
                              {payStatus === "confirmed" ? "Deliver" : "Confirm"}
                            </button>
                            <Link
                              href={`/admin/orders/${order.id}`}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors shrink-0"
                              title="Full Order Details"
                            >
                              <ChevronRight size={14} />
                            </Link>
                          </>
                        ) : (
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="h-8 px-3 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors shrink-0"
                          >
                            View <ChevronRight size={13} />
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Mobile Virtual Cards */}
          <div className="md:hidden space-y-3">
            {loading ? (
              <PremiumLoader />
            ) : filtered.length === 0 ? (
              <div className="bg-white p-10 rounded-2xl border border-gray-200/80 text-center">
                <p className="text-sm font-semibold text-gray-700">{emptyLabel}</p>
                <p className="text-xs text-gray-400 mt-0.5">{emptySub}</p>
              </div>
            ) : (
              filtered.map((order) => {
                const payStatus = getNormalizedPaymentStatus(order);
                const ordStatus = getNormalizedOrderStatus(order);
                const total = order.totalAmount ?? order.total ?? 0;
                const pmt = order.payment ?? order.paymentDetails ?? {};
                const firstItem = order.items?.[0];
                const buyerEmail = order.userEmail ?? order.customer?.email ?? "—";
                const isActiveOrder = getOrderBucket(order) === "active";

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl border border-gray-200/80 p-4 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm text-gray-900">
                          {firstItem?.name || "Virtual Product"}
                        </p>
                        {firstItem?.variantName && (
                          <p className="text-xs text-gray-500">{firstItem.variantName}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm text-gray-900">
                          {currency}
                          {Number(total).toFixed(2)}
                        </p>
                        <p className="text-[11px] text-gray-500">{pmt.method ?? "—"}</p>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs space-y-0.5">
                      <p className="text-gray-700 font-medium truncate">{buyerEmail}</p>
                      {pmt.transactionId && (
                        <p className="text-[11px] font-mono text-gray-500 truncate">
                          TrxID: {pmt.transactionId}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 mb-1">Payment</p>
                        <StatusBadge value={payStatus} options={VIRTUAL_PMT_OPTIONS} />
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold text-gray-400 mb-1">Status</p>
                        <StatusBadge value={ordStatus} options={VIRTUAL_ORD_OPTIONS} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id)}
                          className="w-8 h-8 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 inline-flex items-center"
                        >
                          {isActiveOrder ? "Details" : "View Order"}
                        </Link>
                      </div>
                      {isActiveOrder && (
                        <button
                          type="button"
                          onClick={() => setFulfillOrder(order)}
                          className="h-8 px-4 rounded-lg bg-gray-950 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {payStatus === "confirmed" ? "Deliver" : "Confirm"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── Variation-Based Virtual Confirm & Fulfill Modal ─────── */}
      <AnimatePresence>
        {fulfillOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFulfillOrder(null)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-gray-50 rounded-2xl sm:rounded-3xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-5 py-4 bg-white border-b border-gray-100 shrink-0">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-900 truncate">
                    Order #{fulfillOrder.id.slice(0, 8).toUpperCase()}
                  </h3>
                  <p className="text-xs text-gray-400 truncate">
                    {fulfillOrder.userEmail || fulfillOrder.customer?.email || ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFulfillOrder(null)}
                  className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                <VirtualOrderFulfillPanel
                  order={fulfillOrder as any}
                  currency={currency}
                  showItemSummary={true}
                  onOrderUpdated={(updated) => {
                    const merged = { ...fulfillOrder, ...updated } as Order;
                    setOrders((prev) =>
                      prev.map((o) => (o.id === updated.id ? ({ ...o, ...updated } as Order) : o))
                    );
                    if (getOrderBucket(merged) !== "active") {
                      setFulfillOrder(null);
                    } else {
                      setFulfillOrder(merged);
                    }
                  }}
                  onNotify={(msg) => showToast(msg)}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Invoice Modal Preview (Physical Orders) ─────────────── */}
      <AnimatePresence>
        {showInvoice && selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 md:p-10">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInvoice(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="relative w-full max-w-4xl h-full bg-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center text-gray-700">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Invoice Preview</h3>
                    <p className="text-[11px] text-gray-400 font-mono">
                      #{selectedOrder.id.slice(0, 12).toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="h-9 px-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Printer size={14} /> Print
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadPDF(selectedOrder)}
                    disabled={downloadingPdf}
                    className="h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Download size={14} />
                    {downloadingPdf ? "Generating…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInvoice(false)}
                    className="w-9 h-9 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <XCircle size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gray-50">
                <div id="invoice-capture" className="mx-auto w-fit">
                  <OrderInvoice
                    order={selectedOrder as any}
                    currency={currency}
                    storeName={settings?.storeName}
                    storeAddress={settings?.contactAddress}
                    storePhone={settings?.contactPhone}
                    storeEmail={settings?.contactEmail}
                    logoUrl={settings?.logoUrl}
                    signatureUrl={settings?.signatureUrl}
                  />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <DeleteConfirmModal
        isOpen={deleteModal.isOpen}
        isDeleting={deleting}
        onClose={() => setDeleteModal({ isOpen: false, orderId: "" })}
        onConfirm={confirmDelete}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<PremiumLoader />}>
      <AdminOrdersContent />
    </Suspense>
  );
}
