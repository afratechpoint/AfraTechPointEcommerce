"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, CheckCircle2, XCircle, Clock,
  Package, MapPin, Receipt, User, AlertTriangle,
  Phone, Mail, Hash, Send, CreditCard, Truck, Trash2, RefreshCw, ChevronDown,
  Link2, KeyRound, Plus, Zap, Copy, ExternalLink
} from "lucide-react";
import { useSettings } from "@/components/SettingsProvider";
import DeleteConfirmModal from "@/components/admin/DeleteConfirmModal";
import CancelOrderModal from "@/components/admin/CancelOrderModal";
import VirtualOrderFulfillPanel from "@/components/admin/VirtualOrderFulfillPanel";
import { cn } from "@/lib/utils";
import { getAuth } from "firebase/auth";
import { copyText } from "@/lib/clipboard";
import { useRealtime } from "@/lib/realtime-client";

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
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
  userEmail?: string;
  payment?: { method?: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  paymentDetails?: { method?: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  shippingAddress?: { fullName?: string; phone?: string; address?: string; city?: string; postalCode?: string; division?: string; district?: string; upazila?: string };
  customer?: { name?: string; phone?: string; address?: string; city?: string; email?: string };
  courier?: string;
  courierTrackingCode?: string;
  courierConsignmentId?: string | number;
  courierStatus?: string;
  items: { name: string; price: number; quantity: number; image?: string; variantName?: string; productId?: string; productKind?: string; virtualType?: string }[];
  hasPhysical?: boolean;
  fulfillment?: { targetUrl?: string; notes?: string; customFields?: { product?: string; label: string; value: string }[] } | null;
  deliveries?: { productId: string; type: string; value: string; password?: string; note?: string; revealed?: boolean }[];
}

const PMT_STATUS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", label: "Pending Verification" },
  pending_cod: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Cash on Delivery" },
  confirmed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Payment Confirmed" },
  refunded: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Refunded" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", label: "Cancelled" },
};

const ORD_STATUS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400", label: "Pending" },
  processing: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Processing" },
  shipped: { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", label: "Shipped" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Delivered" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", label: "Cancelled" },
};

const VIRTUAL_ORD_STATUS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Awaiting Fulfillment" },
  processing: { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", label: "In Progress" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Completed" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", label: "Cancelled" },
};

const METHOD_COLOR: Record<string, string> = {
  bKash: "bg-pink-100 text-pink-800",
  Nagad: "bg-orange-100 text-orange-800",
  Rocket: "bg-purple-100 text-purple-800",
};

const DELIVERY_TYPE_OPTIONS = [
  { value: "account", label: "Account (ID & password)" },
  { value: "license", label: "License key" },
  { value: "software", label: "Software download URL" },
];

export default function AdminOrderDetailPage() {
  const { orderId } = useParams() as { orderId: string };
  const router = useRouter();
  const settings = useSettings() as any;
  const currency = settings?.currencySymbol ?? "৳";

  const [order, setOrder] = useState<Order | null>(null);
  const [fetching, setFetching] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);

  const [fraudData, setFraudData] = useState<any>(null);
  const [checkingFraud, setCheckingFraud] = useState(false);

  // Account Provide quick form
  const [accountValue, setAccountValue] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountNote, setAccountNote] = useState("");

  // Manual digital-delivery override
  const [deliveryType, setDeliveryType] = useState("account");
  const [deliveryValue, setDeliveryValue] = useState("");
  const [deliveryPassword, setDeliveryPassword] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");

  const fetchOrder = React.useCallback(async (silent = false) => {
    if (!orderId) return;
    const headers = await getAuthHeaders();
    fetch(`/api/orders/${orderId}`, { headers, cache: "no-store" })
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
  }, [orderId]);

  useEffect(() => {
    fetchOrder(false);
  }, [fetchOrder]);

  useRealtime("orders", () => fetchOrder(true));

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const patch = async (fields: Record<string, any>) => {
    if (!order) return;
    setUpdating(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setOrder((prev) => (prev ? { ...prev, ...updated } : prev));
      return true;
    } catch {
      showToast("Update failed. Please try again.", false);
      return false;
    } finally {
      setUpdating(false);
    }
  };

  const updatePaymentStatus = async (s: string) => {
    if (s === "cancelled") {
      setIsCancelModalOpen(true);
      return;
    }
    const updateObj: any = { paymentStatus: s };
    if (s === "confirmed" && order?.paymentStatus === "pending") {
      updateObj.orderStatus = "processing";
      updateObj.status = "Processing";
    }
    const ok = await patch(updateObj);
    if (ok) showToast(`Payment marked as ${s}.`);
  };

  const updateOrderStatus = async (s: string) => {
    if (s === "cancelled") {
      setIsCancelModalOpen(true);
      return;
    }
    const ok = await patch({
      orderStatus: s,
      status: s.charAt(0).toUpperCase() + s.slice(1),
    });
    if (ok) showToast(`Order status updated.`);
  };

  const handlePhysicalCancelConfirm = async (reason: string, markRefunded: boolean) => {
    const currentPay = (order?.paymentStatus ?? "pending").toLowerCase();
    const isUpdatingExisting =
      (order?.orderStatus ?? order?.status ?? "").toLowerCase() === "cancelled" ||
      currentPay === "cancelled";

    const ok = await patch({
      orderStatus: "cancelled",
      status: "Cancelled",
      cancellationReason: reason,
      paymentStatus: markRefunded
        ? "refunded"
        : currentPay === "refunded"
        ? "refunded"
        : "cancelled",
    });
    if (ok) {
      setIsCancelModalOpen(false);
      showToast(isUpdatingExisting ? "Cancellation reason updated." : "Order cancelled.");
    }
  };

  const confirmWithAccount = async () => {
    if (!accountValue.trim() || !accountPassword.trim()) {
      showToast("Enter both account ID/email and password.", false);
      return;
    }
    const virtualItem = order?.items.find((i) => i.productKind === "virtual");
    const entry = {
      productId: virtualItem?.productId || "",
      type: "account",
      value: accountValue.trim(),
      password: accountPassword.trim(),
      note: accountNote.trim() || undefined,
      revealed: true,
    };
    const others = (order?.deliveries || []).filter((d) => d.type !== "account");
    const ok = await patch({
      paymentStatus: "confirmed",
      orderStatus: "delivered",
      status: "Delivered",
      deliveries: [...others, entry],
    });
    if (ok) {
      setAccountValue("");
      setAccountPassword("");
      setAccountNote("");
      showToast("Account sent and order marked completed!");
    }
  };

  const attachDelivery = async () => {
    if (!deliveryValue.trim()) {
      showToast("Enter the delivery value first.", false);
      return;
    }
    const virtualItem = order?.items.find((i) => i.productKind === "virtual");
    const entry = {
      productId: virtualItem?.productId || "",
      type: deliveryType,
      value: deliveryValue.trim(),
      password: deliveryPassword.trim() || undefined,
      note: deliveryNote.trim() || undefined,
      revealed: true,
    };
    const ok = await patch({ deliveries: [...(order?.deliveries || []), entry] });
    if (ok) {
      setDeliveryValue("");
      setDeliveryPassword("");
      setDeliveryNote("");
      showToast("Delivery attached — visible to customer once payment is confirmed.");
    }
  };

  const shipWithSteadfast = async () => {
    if (!order) return;
    setUpdating(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/courier/steadfast/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ orderId: order.id, deliveryType: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create parcel");

      showToast("Order shipped with Steadfast!");
      const updatedOrder = await (await fetch(`/api/orders/${order.id}`, { headers })).json();
      setOrder(updatedOrder);
    } catch (err: any) {
      showToast(err.message || "Shipping failed", false);
    } finally {
      setUpdating(false);
    }
  };

  const refreshCourierStatus = async () => {
    if (!order || !order.courierConsignmentId) return;
    setUpdating(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/courier/steadfast/status/${order.id}`, {
        method: "GET",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch status");

      showToast(`Courier status updated: ${data.status}`);
      const updatedOrder = await (await fetch(`/api/orders/${order.id}`, { headers })).json();
      setOrder(updatedOrder);
    } catch (err: any) {
      showToast(err.message || "Status refresh failed", false);
    } finally {
      setUpdating(false);
    }
  };

  const checkCustomerFraud = async () => {
    const rawPhone = order?.shippingAddress?.phone ?? order?.customer?.phone;
    if (!rawPhone) {
      showToast("No phone number found for this customer", false);
      return;
    }

    const phone = rawPhone.replace(/\D/g, "").slice(-11);
    if (phone.length < 11) {
      showToast("Valid 11-digit phone number is required", false);
      return;
    }

    setCheckingFraud(true);
    setFraudData(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/courier/steadfast/fraud-check/${phone}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check fraud");
      setFraudData(data.data);
      showToast("Fraud check completed");
    } catch (err: any) {
      showToast(err.message || "Fraud check failed", false);
    } finally {
      setCheckingFraud(false);
    }
  };

  const isVirtual =
    order?.hasPhysical === false ||
    (Array.isArray(order?.items) &&
      order!.items.length > 0 &&
      order!.items.every((i) => i.productKind === "virtual"));

  const confirmDelete = async () => {
    if (!order) return;
    setIsDeleting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error();
      showToast("Order deleted successfully.");
      setIsDeleteModalOpen(false);
      setTimeout(
        () => router.push(`/admin/orders?section=${isVirtual ? "virtual" : "physical"}`),
        1000
      );
    } catch {
      showToast("Failed to delete order.", false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!order || !order.id) {
    return (
      <div className="text-center py-28">
        <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Package size={24} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-semibold mb-2">Order not found</p>
        <Link href="/admin/orders" className="text-sm text-black font-bold underline underline-offset-2">
          Back to Orders
        </Link>
      </div>
    );
  }

  const rawPay = (order.paymentStatus ?? "pending").toLowerCase();
  const payStatus = rawPay === "failed" ? "cancelled" : rawPay;
  const rawOrd = (order.orderStatus ?? order.status ?? "pending").toLowerCase();
  const ordStatus = rawOrd === "completed" ? "delivered" : rawOrd;
  const total = order.totalAmount ?? order.total ?? 0;
  const pmt = order.payment ?? order.paymentDetails ?? {};
  const addr = order.shippingAddress;
  const cust = order.customer;
  const payInfo = PMT_STATUS[payStatus] ?? PMT_STATUS.pending;
  const ordInfo = isVirtual
    ? VIRTUAL_ORD_STATUS[ordStatus] ?? VIRTUAL_ORD_STATUS.pending
    : ORD_STATUS[ordStatus] ?? ORD_STATUS.pending;

  const copyHelper = async (value: string, label: string) => {
    const ok = await copyText(value);
    showToast(ok ? `${label} copied!` : "Couldn't access clipboard.", ok);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     CLEAN MINIMALIST VIRTUAL ORDER VIEW
     ══════════════════════════════════════════════════════════════════════════ */
  if (isVirtual) {
    const buyerEmail = order.userEmail ?? cust?.email ?? "—";
    const buyerName = cust?.name || addr?.fullName || buyerEmail.split("@")[0];
    const buyerPhone = addr?.phone || cust?.phone || pmt.senderNumber || "—";

    return (
      <div className="w-full min-w-0 space-y-4 pb-12">
        {/* Simple Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/orders?section=virtual"
              className="w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-600 hover:text-black transition-colors shrink-0"
              title="Back to Orders"
            >
              <ArrowLeft size={16} />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-gray-900 font-mono">
                  #{order.id.slice(0, 10).toUpperCase()}
                </h1>
                <span
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-[11px] font-semibold",
                    ordInfo.bg,
                    ordInfo.text
                  )}
                >
                  {ordInfo.label}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(order.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
            disabled={updating}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
            title="Delete Order"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Row 1: Item & Customer (No Duplication) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Item Card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-gray-900">Item</h3>
              {order.items?.map((item, i) => {
                const showVar =
                  item.variantName &&
                  item.variantName.trim().toLowerCase() !== (item.name || "").trim().toLowerCase();
                return (
                  <div key={i} className="flex items-center gap-3">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-12 h-12 rounded-xl object-cover border border-gray-100 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-100 rounded-xl shrink-0 flex items-center justify-center text-gray-400">
                        <Package size={18} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {showVar ? `${item.variantName} · ` : ""}Qty {item.quantity}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 shrink-0">
                      {currency}
                      {(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Total</span>
              <span className="text-base font-bold text-gray-900">
                {currency}
                {Number(total).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Customer Card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900">Customer</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">Name</span>
                <span className="font-semibold text-gray-900 text-right break-all">{buyerName}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">Email</span>
                <span className="font-semibold text-gray-900 text-right break-all">{buyerEmail}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">Phone</span>
                <span className="font-semibold text-gray-900 font-mono text-right">{buyerPhone}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2 & 3: Full-Width Payment & Delivery Confirmation */}
        <VirtualOrderFulfillPanel
          order={order as any}
          currency={currency}
          showItemSummary={false}
          onOrderUpdated={(updated) =>
            setOrder((prev) => (prev ? ({ ...prev, ...updated } as any) : prev))
          }
          onNotify={(msg, ok = true) => showToast(msg, ok)}
        />

        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          isDeleting={isDeleting}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={confirmDelete}
        />

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className={cn(
                "fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg z-50 text-xs font-semibold whitespace-nowrap",
                toast.ok ? "bg-gray-900 text-white" : "bg-red-600 text-white"
              )}
            >
              {toast.ok ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} />}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PHYSICAL ORDER MANAGEMENT VIEW (COURIER & SHIPPING)
     ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="w-full min-w-0 space-y-6 pb-10">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
        <Link
          href="/admin/orders?section=physical"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={15} /> Back to Physical Orders
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono">
              {new Date(order.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-300" />
            <span className="text-xs font-mono font-semibold text-gray-600">
              #{order.id.slice(0, 12).toUpperCase()}
            </span>
          </div>
          {ordStatus !== "cancelled" && payStatus !== "cancelled" && (
            <button
              type="button"
              onClick={() => setIsCancelModalOpen(true)}
              disabled={updating}
              className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <XCircle size={14} /> Cancel Order
            </button>
          )}
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            disabled={updating}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
            title="Delete Order"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Saved Cancellation Reason Banner (Physical Order) */}
      {(ordStatus === "cancelled" || payStatus === "cancelled") && (
        <div className="bg-red-50/70 rounded-2xl border border-red-200 p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-800">
              Cancellation Reason (Shown to Customer)
            </p>
            <p className="text-xs text-red-700 mt-1 break-words">
              {order.cancellationReason || "No specific reason added yet."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCancelModalOpen(true)}
            className="h-8 px-3 rounded-lg bg-white border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-100/50 shrink-0 transition-colors cursor-pointer"
          >
            {order.cancellationReason ? "Edit Reason" : "Add Reason"}
          </button>
        </div>
      )}

      {/* Order Items Card */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-gray-500" />
            <h3 className="font-bold text-gray-900 text-sm">Order Items</h3>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold",
              ordInfo.bg,
              ordInfo.text
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", ordInfo.dot)} />
            {ordInfo.label}
          </span>
        </div>

        <div className="space-y-2">
          {order.items?.map((item, i) => (
            <div
              key={i}
              className="flex items-start md:items-center gap-3 p-3 rounded-xl bg-gray-50/70"
            >
              {item.image ? (
                <div className="w-12 h-12 bg-white rounded-xl shrink-0 overflow-hidden border border-gray-100">
                  <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />
                </div>
              ) : (
                <div className="w-12 h-12 bg-gray-100 rounded-xl shrink-0 flex items-center justify-center">
                  <Package size={18} className="text-gray-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                {item.variantName && <p className="text-xs text-gray-500">{item.variantName}</p>}
                <p className="text-xs text-gray-400 mt-0.5">
                  Qty: {item.quantity} × {currency}
                  {item.price.toFixed(2)}
                </p>
              </div>
              <p className="text-sm font-bold text-gray-900 shrink-0">
                {currency}
                {(item.price * item.quantity).toFixed(2)}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-col mt-4 pt-4 border-t border-gray-100 space-y-2">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Subtotal</span>
            <span className="font-semibold text-gray-800">
              {currency}
              {Number(order.subtotal ?? total).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Delivery Charge</span>
            <span className={cn("font-semibold", order.deliveryCharge === 0 ? "text-emerald-600" : "text-gray-800")}>
              {order.deliveryCharge === 0
                ? "Free"
                : `${currency}${Number(order.deliveryCharge ?? 0).toFixed(2)}`}
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span className="text-sm font-bold text-gray-900">
              Order Total{" "}
              {pmt.method === "Cash on Delivery" && (
                <span className="text-xs text-blue-600 font-semibold">(COD)</span>
              )}
            </span>
            <span className="text-lg font-black text-gray-900">
              {currency}
              {Number(total).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment & Customer Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Payment */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-gray-500" />
              <h3 className="font-bold text-gray-900 text-sm">Payment Info</h3>
            </div>
            {pmt.method && (
              <span
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold",
                  METHOD_COLOR[pmt.method] ?? "bg-gray-100 text-gray-700"
                )}
              >
                {pmt.method}
              </span>
            )}
          </div>

          {pmt.method === "Cash on Delivery" ? (
            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 font-medium">
              Cash on Delivery — collect <strong>{currency}{Number(total).toFixed(2)}</strong> upon parcel delivery.
            </div>
          ) : (
            <div className="space-y-3 divide-y divide-gray-50">
              {[
                { icon: <Phone size={12} />, label: "Sender Number", val: pmt.senderNumber ?? "—" },
                { icon: <Hash size={12} />, label: "Transaction ID", val: pmt.transactionId ?? "—" },
                { icon: <Send size={12} />, label: "Sent to Account", val: pmt.accountUsed ?? "—" },
              ].map(({ icon, label, val }) => (
                <div key={label} className="flex items-start justify-between pt-3 first:pt-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 shrink-0 mt-0.5">
                    {icon} {label}
                  </div>
                  <p className="text-sm font-bold text-gray-900 font-mono text-right break-all ml-3">
                    {val}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Customer Shipping Info */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <User size={16} className="text-gray-500" />
            <h3 className="font-bold text-gray-900 text-sm">Customer & Shipping Address</h3>
          </div>
          <div className="space-y-3 divide-y divide-gray-50">
            {[
              { icon: <User size={12} />, label: "Name", val: addr?.fullName ?? cust?.name ?? "—" },
              { icon: <Phone size={12} />, label: "Phone", val: addr?.phone ?? cust?.phone ?? "—" },
              { icon: <Mail size={12} />, label: "Email", val: order.userEmail ?? cust?.email ?? "—" },
              {
                icon: <MapPin size={12} />,
                label: "Address",
                val:
                  [
                    addr?.address ?? cust?.address,
                    addr?.upazila,
                    addr?.district,
                    addr?.division,
                    !addr?.division ? addr?.city ?? cust?.city : null,
                    addr?.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—",
              },
            ].map(({ icon, label, val }) => (
              <div key={label} className="flex items-start justify-between pt-3 first:pt-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 shrink-0 mt-0.5">
                  {icon} {label}
                </div>
                <p className="text-sm font-semibold text-gray-900 text-right ml-3 break-all">{val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Courier & Shipping (Physical Orders Only) */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-blue-600" />
            <h3 className="font-bold text-gray-900 text-sm">Courier & Dispatch</h3>
          </div>
          {order.courier && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
              {order.courier}
            </span>
          )}
        </div>

        {!order.courierTrackingCode ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={shipWithSteadfast}
                disabled={updating || ordStatus === "cancelled"}
                className="flex-[2] flex items-center justify-center gap-2 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                <Send size={14} /> Send to Steadfast Courier
              </button>
              <button
                onClick={checkCustomerFraud}
                disabled={checkingFraud || updating}
                className="flex-1 flex items-center justify-center gap-2 h-10 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-xs font-bold border border-amber-200 transition-all disabled:opacity-50 cursor-pointer"
              >
                {checkingFraud ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <AlertTriangle size={14} />
                )}
                Check Fraud
              </button>
            </div>

            {fraudData && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className={cn(
                  "p-4 rounded-xl border flex flex-col gap-3",
                  fraudData.fraudReports > 0
                    ? "bg-red-50 border-red-100"
                    : "bg-gray-50 border-gray-100"
                )}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-gray-600">Customer Delivery History</h4>
                  {fraudData.fraudReports > 0 && (
                    <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={11} /> {fraudData.fraudReports} Fraud Reports
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] text-gray-400 font-semibold">Total Parcels</p>
                    <p className="text-sm font-bold text-gray-900">{fraudData.totalParcels}</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] text-gray-400 font-semibold">Success Rate</p>
                    <p
                      className={cn(
                        "text-sm font-bold",
                        fraudData.successRate > 80 ? "text-emerald-600" : "text-amber-600"
                      )}
                    >
                      {fraudData.successRate}%
                    </p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                    <p className="text-[10px] text-gray-400 font-semibold">Cancelled</p>
                    <p className="text-sm font-bold text-red-600">{fraudData.cancelled}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <div className="space-y-3 divide-y divide-gray-50">
            {[
              { icon: <Hash size={12} />, label: "Tracking Code", val: order.courierTrackingCode, copy: true },
              { icon: <Hash size={12} />, label: "Consignment ID", val: order.courierConsignmentId?.toString() ?? "—" },
              { icon: <Clock size={12} />, label: "Courier Status", val: order.courierStatus?.replace(/_/g, " ") ?? "pending" },
            ].map(({ icon, label, val, copy }) => (
              <div key={label} className="flex items-start justify-between pt-3 first:pt-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 shrink-0 mt-0.5">
                  {icon} {label}
                </div>
                <div className="flex flex-col items-end gap-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        "text-sm font-bold text-gray-900 font-mono text-right truncate max-w-full",
                        label === "Tracking Code" && "text-blue-600"
                      )}
                    >
                      {val}
                    </p>
                    {label === "Courier Status" && (
                      <button
                        onClick={refreshCourierStatus}
                        disabled={updating}
                        className="p-1 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-black transition-all disabled:opacity-50 cursor-pointer"
                        title="Refresh Status"
                      >
                        <RefreshCw size={11} className={cn(updating && "animate-spin")} />
                      </button>
                    )}
                  </div>
                  {copy && (
                    <button
                      onClick={() => copyHelper(val || "", "Tracking code")}
                      className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                    >
                      Copy Tracking
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status Controls */}
      <div className="pt-2">
        <div className="flex justify-center">
          <button
            onClick={() => setIsManualOpen(!isManualOpen)}
            className="flex items-center gap-2 px-5 py-2 rounded-full border border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:border-gray-300 transition-all text-xs font-semibold cursor-pointer"
          >
            {isManualOpen ? "Hide Manual Status Controls" : "Show Manual Status Controls"}
            <ChevronDown size={13} className={cn("transition-transform duration-200", isManualOpen && "rotate-180")} />
          </button>
        </div>

        <AnimatePresence>
          {isManualOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div className="bg-white rounded-2xl border border-gray-200/80 p-5">
                <h3 className="font-bold text-gray-800 text-xs mb-3 flex items-center gap-1.5">
                  <CreditCard size={14} className="text-gray-400" /> Payment Status
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["pending", "confirmed", "refunded", "cancelled"].map((s) => (
                    <button
                      key={s}
                      onClick={() => updatePaymentStatus(s)}
                      disabled={updating || payStatus === s}
                      className={cn(
                        "px-3.5 h-8 rounded-xl text-xs font-semibold border transition-all cursor-pointer disabled:cursor-default",
                        payStatus === s
                          ? "bg-gray-950 text-white border-gray-950"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900"
                      )}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-200/80 p-5">
                <h3 className="font-bold text-gray-800 text-xs mb-3 flex items-center gap-1.5">
                  <Truck size={14} className="text-gray-400" /> Shipping Status
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["pending", "processing", "shipped", "delivered", "cancelled"].map((s) => (
                    <button
                      key={s}
                      onClick={() => updateOrderStatus(s)}
                      disabled={updating || ordStatus === s}
                      className={cn(
                        "px-3.5 h-8 rounded-xl text-xs font-semibold border transition-all cursor-pointer disabled:cursor-default",
                        ordStatus === s
                          ? "bg-gray-950 text-white border-gray-950"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900"
                      )}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        isDeleting={isDeleting}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
      />

      <CancelOrderModal
        isOpen={isCancelModalOpen}
        orderId={order.id}
        initialReason={order.cancellationReason || ""}
        canMarkRefunded={
          payStatus !== "refunded" && Boolean(pmt.method && pmt.method !== "Cash on Delivery")
        }
        isSubmitting={updating}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handlePhysicalCancelConfirm}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg z-50 text-xs font-semibold whitespace-nowrap",
              toast.ok ? "bg-gray-900 text-white" : "bg-red-600 text-white"
            )}
          >
            {toast.ok ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
