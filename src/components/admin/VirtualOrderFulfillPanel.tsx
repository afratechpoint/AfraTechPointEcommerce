"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Copy, ExternalLink, Send, Loader2, RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { authenticatedFetch } from "@/lib/api-helper";
import CancelOrderModal from "@/components/admin/CancelOrderModal";

export interface VirtualOrderItem {
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  variantName?: string | null;
  productKind?: string;
  virtualType?: "social" | "account" | "license" | "software" | string | null;
}

export interface VirtualDeliveryEntry {
  productId: string;
  itemName?: string;
  variantName?: string | null;
  type: string;
  value: string;
  password?: string;
  note?: string;
  revealed?: boolean;
}

export interface VirtualOrderData {
  id: string;
  createdAt?: any;
  total?: number;
  totalAmount?: number;
  paymentStatus?: string;
  orderStatus?: string;
  status?: string;
  cancellationReason?: string;
  userEmail?: string;
  payment?: { method?: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  paymentDetails?: { method?: string; senderNumber?: string; transactionId?: string; accountUsed?: string };
  shippingAddress?: { fullName?: string; phone?: string };
  customer?: { name?: string; phone?: string; email?: string };
  items: VirtualOrderItem[];
  fulfillment?: {
    targetUrl?: string;
    notes?: string;
    customFields?: { product?: string; label: string; value: string }[];
  } | null;
  deliveries?: VirtualDeliveryEntry[];
}

const INPUT =
  "w-full h-10 px-3.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 focus:border-black focus:ring-2 focus:ring-black/5 outline-none transition-all text-sm text-gray-900 placeholder:text-gray-400 min-w-0";

interface Props {
  order: VirtualOrderData;
  currency?: string;
  showItemSummary?: boolean;
  onOrderUpdated: (updated: VirtualOrderData) => void;
  onNotify?: (msg: string, ok?: boolean) => void;
}

export default function VirtualOrderFulfillPanel({
  order,
  currency = "৳",
  showItemSummary = false,
  onOrderUpdated,
  onNotify,
}: Props) {
  const [updating, setUpdating] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const rawPay = (order.paymentStatus ?? "pending").toLowerCase();
  const payStatus = rawPay === "failed" ? "cancelled" : rawPay;
  const rawOrd = (order.orderStatus ?? order.status ?? "pending").toLowerCase();
  const ordStatus = rawOrd === "completed" ? "delivered" : rawOrd;
  const total = order.totalAmount ?? order.total ?? 0;
  const pmt = order.payment ?? order.paymentDetails ?? {};

  const primaryType = (order.items?.[0]?.virtualType || "social") as string;
  const firstItem = order.items?.[0];

  const existingAccount = order.deliveries?.find((d) => d.type === "account");
  const existingLicense = order.deliveries?.find((d) => d.type === "license");
  const existingSoftware = order.deliveries?.find((d) => d.type === "software");
  const existingSocial = order.deliveries?.find((d) => d.type === "social");

  const [accountEmail, setAccountEmail] = useState(existingAccount?.value || "");
  const [accountPassword, setAccountPassword] = useState(existingAccount?.password || "");
  const [accountNote, setAccountNote] = useState(existingAccount?.note || "");

  const [licenseKey, setLicenseKey] = useState(existingLicense?.value || "");
  const [licenseNote, setLicenseNote] = useState(existingLicense?.note || "");

  const [downloadLink, setDownloadLink] = useState(existingSoftware?.value || "");
  const [softwareNote, setSoftwareNote] = useState(existingSoftware?.note || "");

  const [socialNote, setSocialNote] = useState(existingSocial?.note || "");

  useEffect(() => {
    const acc = order.deliveries?.find((d) => d.type === "account");
    const lic = order.deliveries?.find((d) => d.type === "license");
    const sft = order.deliveries?.find((d) => d.type === "software");
    const soc = order.deliveries?.find((d) => d.type === "social");

    if (acc) {
      setAccountEmail(acc.value || "");
      setAccountPassword(acc.password || "");
      setAccountNote(acc.note || "");
    }
    if (lic) {
      setLicenseKey(lic.value || "");
      setLicenseNote(lic.note || "");
    }
    if (sft) {
      setDownloadLink(sft.value || "");
      setSoftwareNote(sft.note || "");
    } else if (primaryType === "software" && order.items?.[0]?.productId) {
      fetch(`/api/products/${order.items[0].productId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((prod) => {
          if (prod?.virtualConfig?.downloadUrl) {
            setDownloadLink((prev) => prev || prod.virtualConfig.downloadUrl);
            const metaNote = [prod.virtualConfig.version, prod.virtualConfig.fileSize]
              .filter(Boolean)
              .join(" · ");
            if (metaNote) setSoftwareNote((prev) => prev || metaNote);
          }
        })
        .catch(() => {});
    }
    if (soc) {
      setSocialNote(soc.note || "");
    }
  }, [order.id, order.deliveries, primaryType, order.items]);

  const notify = (msg: string, ok = true) => onNotify?.(msg, ok);

  const copyHelper = async (val: string, label: string) => {
    const ok = await copyText(val);
    notify(ok ? `${label} copied!` : "Could not copy.", ok);
  };

  const patchOrder = async (fields: Record<string, any>, successMsg: string) => {
    setUpdating(true);
    try {
      const res = await authenticatedFetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      onOrderUpdated(updated);
      notify(successMsg, true);
      return true;
    } catch {
      notify("Failed to update order.", false);
      return false;
    } finally {
      setUpdating(false);
    }
  };

  const handleConfirmPaymentOnly = () => {
    const nextOrd = ordStatus === "pending" ? "processing" : ordStatus;
    patchOrder(
      {
        paymentStatus: "confirmed",
        orderStatus: nextOrd,
        status: nextOrd === "delivered" ? "Delivered" : "Processing",
      },
      "Payment confirmed!"
    );
  };

  const handleRejectPayment = () => {
    setCancelModalOpen(true);
  };

  const handleConfirmCancellation = async (reason: string, markRefunded: boolean) => {
    const isUpdatingExistingReason = ordStatus === "cancelled" || payStatus === "cancelled";
    const nextPaymentStatus = markRefunded
      ? "refunded"
      : payStatus === "refunded"
      ? "refunded"
      : "cancelled";

    const ok = await patchOrder(
      {
        paymentStatus: nextPaymentStatus,
        orderStatus: "cancelled",
        status: "Cancelled",
        cancellationReason: reason,
      },
      isUpdatingExistingReason ? "Cancellation reason updated." : "Order cancelled."
    );
    if (ok) {
      setCancelModalOpen(false);
    }
  };

  const handleCompleteSocial = (alsoConfirmPayment: boolean) => {
    const deliveries = [...(order.deliveries || []).filter((d) => d.type !== "social")];
    if (socialNote.trim()) {
      deliveries.push({
        productId: firstItem?.productId || "",
        itemName: firstItem?.name,
        variantName: firstItem?.variantName,
        type: "social",
        value: "Completed",
        note: socialNote.trim(),
        revealed: true,
      });
    }
    patchOrder(
      {
        ...(alsoConfirmPayment ? { paymentStatus: "confirmed" } : {}),
        orderStatus: "delivered",
        status: "Delivered",
        ...(socialNote.trim() ? { deliveries } : {}),
      },
      "Order completed!"
    );
  };

  const handleDeliverAccount = () => {
    if (!accountEmail.trim() || !accountPassword.trim()) {
      notify("Enter both Account ID/Email and Password.", false);
      return;
    }
    const others = (order.deliveries || []).filter((d) => d.type !== "account");
    patchOrder(
      {
        paymentStatus: "confirmed",
        orderStatus: "delivered",
        status: "Delivered",
        deliveries: [
          ...others,
          {
            productId: firstItem?.productId || "",
            itemName: firstItem?.name,
            variantName: firstItem?.variantName,
            type: "account",
            value: accountEmail.trim(),
            password: accountPassword.trim(),
            note: accountNote.trim() || undefined,
            revealed: true,
          },
        ],
      },
      "Account sent & order completed!"
    );
  };

  const handleDeliverLicense = () => {
    if (!licenseKey.trim()) {
      notify("Enter the license key.", false);
      return;
    }
    const others = (order.deliveries || []).filter((d) => d.type !== "license");
    patchOrder(
      {
        paymentStatus: "confirmed",
        orderStatus: "delivered",
        status: "Delivered",
        deliveries: [
          ...others,
          {
            productId: firstItem?.productId || "",
            itemName: firstItem?.name,
            variantName: firstItem?.variantName,
            type: "license",
            value: licenseKey.trim(),
            note: licenseNote.trim() || undefined,
            revealed: true,
          },
        ],
      },
      "License key sent & order completed!"
    );
  };

  const handleDeliverSoftware = () => {
    if (!downloadLink.trim()) {
      notify("Enter the download URL.", false);
      return;
    }
    const others = (order.deliveries || []).filter((d) => d.type !== "software");
    patchOrder(
      {
        paymentStatus: "confirmed",
        orderStatus: "delivered",
        status: "Delivered",
        deliveries: [
          ...others,
          {
            productId: firstItem?.productId || "",
            itemName: firstItem?.name,
            variantName: firstItem?.variantName,
            type: "software",
            value: downloadLink.trim(),
            note: softwareNote.trim() || undefined,
            revealed: true,
          },
        ],
      },
      "Download link unlocked & order completed!"
    );
  };

  const hasCustomFields = Boolean(order.fulfillment?.customFields?.length);

  return (
    <div className="space-y-4">
      {/* Compact Item Summary (Only shown inside Quick Modal) */}
      {showItemSummary && (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-4 space-y-2.5">
          {order.items?.map((item, idx) => {
            const showVar =
              item.variantName &&
              item.variantName.trim().toLowerCase() !== (item.name || "").trim().toLowerCase();
            return (
              <div key={idx} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {showVar ? `${item.variantName} · ` : ""}Qty {item.quantity}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-900 shrink-0">
                  {currency}
                  {(item.price * item.quantity).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Payment Card ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">Payment</h3>
          <div className="flex items-center gap-2">
            {pmt.method && (
              <span className="px-2.5 py-0.5 rounded-lg bg-gray-100 text-gray-800 text-xs font-semibold">
                {pmt.method}
              </span>
            )}
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                payStatus === "confirmed"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : payStatus === "refunded"
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : payStatus === "cancelled"
                  ? "bg-red-50 text-red-600 border-red-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              )}
            >
              {payStatus === "confirmed"
                ? "Confirmed"
                : payStatus === "refunded"
                ? "Refunded"
                : payStatus === "cancelled"
                ? "Cancelled"
                : "Pending"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
            <p className="text-xs text-gray-400">Amount</p>
            <p className="text-sm font-bold text-gray-900 mt-1">
              {currency}
              {Number(total).toFixed(2)}
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
            <p className="text-xs text-gray-400">Sender Number</p>
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-sm font-bold text-gray-900 font-mono break-all">
                {pmt.senderNumber || "—"}
              </p>
              {pmt.senderNumber && (
                <button
                  type="button"
                  onClick={() => copyHelper(pmt.senderNumber!, "Sender number")}
                  className="text-gray-400 hover:text-black cursor-pointer shrink-0"
                  title="Copy"
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
            <p className="text-xs text-gray-400">Transaction ID</p>
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-sm font-bold text-gray-900 font-mono break-all">
                {pmt.transactionId || "—"}
              </p>
              {pmt.transactionId && (
                <button
                  type="button"
                  onClick={() => copyHelper(pmt.transactionId!, "Transaction ID")}
                  className="text-gray-400 hover:text-black cursor-pointer shrink-0"
                  title="Copy"
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {payStatus === "confirmed" ? (
            <div className="flex items-center justify-between w-full gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} /> Payment Verified
              </span>
              <button
                type="button"
                disabled={updating}
                onClick={() => patchOrder({ paymentStatus: "refunded" }, "Marked as refunded.")}
                className="text-xs font-medium text-gray-500 hover:text-gray-900 underline cursor-pointer"
              >
                Mark as Refunded
              </button>
            </div>
          ) : payStatus === "refunded" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
              <RotateCcw size={13} /> Payment Refunded
            </span>
          ) : payStatus === "cancelled" || ordStatus === "cancelled" ? (
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs font-semibold text-red-600">Order Cancelled</span>
              {pmt.method && pmt.method !== "Cash on Delivery" && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => patchOrder({ paymentStatus: "refunded" }, "Marked as refunded.")}
                  className="text-xs font-medium text-gray-500 hover:text-gray-900 underline cursor-pointer"
                >
                  Mark as Refunded
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={updating}
                onClick={handleConfirmPaymentOnly}
                className="h-9 px-4 rounded-xl bg-black hover:bg-gray-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {updating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm Payment
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={handleRejectPayment}
                className="h-9 px-4 rounded-xl border border-gray-200 hover:border-red-200 hover:bg-red-50 text-gray-600 hover:text-red-600 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <XCircle size={14} /> Cancel Order
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Saved Cancellation Reason Banner (if Cancelled) ─────── */}
      {(ordStatus === "cancelled" || payStatus === "cancelled") && (
        <div className="bg-red-50/70 rounded-2xl border border-red-200 p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-800">Cancellation Reason (Shown to Customer)</p>
            <p className="text-xs text-red-700 mt-1 break-words">
              {order.cancellationReason || "No specific reason added yet."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCancelModalOpen(true)}
            className="h-8 px-3 rounded-lg bg-white border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-100/50 shrink-0 transition-colors cursor-pointer"
          >
            {order.cancellationReason ? "Edit Reason" : "Add Reason"}
          </button>
        </div>
      )}

      {/* ── Delivery / Order Confirmation Card ──────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">Order Delivery</h3>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "pending", label: "Pending" },
              { id: "processing", label: "In Progress" },
              { id: "delivered", label: "Completed" },
              { id: "cancelled", label: "Cancelled" },
            ].map((st) => {
              const active = ordStatus === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  disabled={updating || active}
                  onClick={() => {
                    if (st.id === "cancelled") {
                      setCancelModalOpen(true);
                      return;
                    }
                    patchOrder(
                      {
                        orderStatus: st.id,
                        status: st.id.charAt(0).toUpperCase() + st.id.slice(1),
                      },
                      `Status updated to ${st.label}.`
                    );
                  }}
                  className={cn(
                    "h-7 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer disabled:cursor-default",
                    active
                      ? "bg-black border-black text-white"
                      : "bg-white border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-300"
                  )}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 1. SOCIAL GROWTH */}
        {primaryType === "social" && (
          <div className="space-y-3.5">
            {(order.fulfillment?.targetUrl || hasCustomFields || order.fulfillment?.notes) && (
              <div className="space-y-2">
                {order.fulfillment?.targetUrl && (
                  <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3.5 py-2.5 border border-gray-100">
                    {/^https?:\/\//i.test(order.fulfillment.targetUrl) ? (
                      <a
                        href={order.fulfillment.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-gray-900 hover:underline break-all inline-flex items-center gap-1.5"
                      >
                        {order.fulfillment.targetUrl} <ExternalLink size={12} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs font-semibold text-gray-900 break-all">
                        {order.fulfillment.targetUrl}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => copyHelper(order.fulfillment!.targetUrl!, "Link")}
                      className="text-gray-400 hover:text-black cursor-pointer shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                )}

                {hasCustomFields &&
                  order.fulfillment!.customFields!.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3.5 py-2.5 border border-gray-100 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="text-[11px] text-gray-400 block">{f.label}</span>
                        {/^https?:\/\//i.test(f.value) ? (
                          <a
                            href={f.value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-gray-900 hover:underline break-all inline-flex items-center gap-1 mt-0.5"
                          >
                            {f.value} <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="font-semibold text-gray-900 break-all mt-0.5 block">
                            {f.value}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyHelper(f.value, f.label)}
                        className="text-gray-400 hover:text-black cursor-pointer shrink-0"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}

                {order.fulfillment?.notes && (
                  <p className="text-xs text-gray-500">Note: {order.fulfillment.notes}</p>
                )}
              </div>
            )}

            <input
              value={socialNote}
              onChange={(e) => setSocialNote(e.target.value)}
              placeholder="Note for customer (optional)"
              className={INPUT}
            />

            <div className="flex flex-wrap items-center gap-2">
              {ordStatus !== "delivered" ? (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleCompleteSocial(payStatus !== "confirmed")}
                  className="h-10 px-5 rounded-xl bg-black hover:bg-gray-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 size={14} />
                  {payStatus !== "confirmed" ? "Confirm & Complete Order" : "Complete Order"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleCompleteSocial(false)}
                  className="h-9 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  Update Note
                </button>
              )}
            </div>
          </div>
        )}

        {/* 2. ACCOUNT PROVIDE */}
        {primaryType === "account" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Email / Username
                </label>
                <input
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="user@example.com"
                  className={cn(INPUT, "font-mono")}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Password
                </label>
                <input
                  value={accountPassword}
                  onChange={(e) => setAccountPassword(e.target.value)}
                  placeholder="Password"
                  className={cn(INPUT, "font-mono")}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Note (Optional)
                </label>
                <input
                  value={accountNote}
                  onChange={(e) => setAccountNote(e.target.value)}
                  placeholder="Profile PIN, validity, or instructions"
                  className={INPUT}
                />
              </div>
            </div>

            <button
              type="button"
              disabled={updating}
              onClick={handleDeliverAccount}
              className="h-10 px-5 rounded-xl bg-black hover:bg-gray-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send size={13} />
              {existingAccount ? "Update Account" : "Confirm & Send Account"}
            </button>
          </div>
        )}

        {/* 3. LICENSE KEY */}
        {primaryType === "license" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  License Key
                </label>
                <input
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXXX-XXXXX-XXXXX"
                  className={cn(INPUT, "font-mono font-semibold")}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Note (Optional)
                </label>
                <input
                  value={licenseNote}
                  onChange={(e) => setLicenseNote(e.target.value)}
                  placeholder="Activation instructions"
                  className={INPUT}
                />
              </div>
            </div>

            <button
              type="button"
              disabled={updating}
              onClick={handleDeliverLicense}
              className="h-10 px-5 rounded-xl bg-black hover:bg-gray-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send size={13} />
              {ordStatus === "delivered" && payStatus === "confirmed"
                ? "Update License Key"
                : "Confirm & Send Key"}
            </button>
          </div>
        )}

        {/* 4. SOFTWARE / ZIP */}
        {primaryType === "software" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Download Link
                </label>
                <input
                  value={downloadLink}
                  onChange={(e) => setDownloadLink(e.target.value)}
                  placeholder="https://…"
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Note (Optional)
                </label>
                <input
                  value={softwareNote}
                  onChange={(e) => setSoftwareNote(e.target.value)}
                  placeholder="Version or ZIP password"
                  className={INPUT}
                />
              </div>
            </div>

            <button
              type="button"
              disabled={updating}
              onClick={handleDeliverSoftware}
              className="h-10 px-5 rounded-xl bg-black hover:bg-gray-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send size={13} />
              {ordStatus === "delivered" && payStatus === "confirmed"
                ? "Update Download Link"
                : "Confirm & Unlock Download"}
            </button>
          </div>
        )}
      </div>

      <CancelOrderModal
        isOpen={cancelModalOpen}
        orderId={order.id}
        initialReason={order.cancellationReason || ""}
        canMarkRefunded={
          payStatus !== "refunded" && Boolean(pmt.method && pmt.method !== "Cash on Delivery")
        }
        isSubmitting={updating}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancellation}
      />
    </div>
  );
}
