"use client";

import React, { useState, useEffect } from "react";
import { X, XCircle, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

const PRESET_REASONS = [
  "Invalid or unverifiable Transaction ID (TrxID)",
  "Payment was not received",
  "Product / service is currently out of stock",
  "Incorrect link or account details provided",
  "Cancelled upon customer request",
];

interface CancelOrderModalProps {
  isOpen: boolean;
  orderId: string;
  initialReason?: string;
  canMarkRefunded?: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string, markRefunded: boolean) => void;
}

export default function CancelOrderModal({
  isOpen,
  orderId,
  initialReason = "",
  canMarkRefunded = false,
  isSubmitting = false,
  onClose,
  onConfirm,
}: CancelOrderModalProps) {
  const [reason, setReason] = useState(initialReason);
  const [markRefunded, setMarkRefunded] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason(initialReason || "");
      setMarkRefunded(false);
    }
  }, [isOpen, initialReason]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed, markRefunded);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => {
            if (!isSubmitting) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                  <XCircle size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-950 truncate">
                    {initialReason ? "Update Cancellation Reason" : "Cancel Order"}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-mono truncate">
                    #{orderId.slice(0, 10).toUpperCase()}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-800 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-700">
                  Reason for cancellation <span className="text-red-500">*</span>
                </label>
                <p className="text-[11px] text-gray-500">
                  This message will be shown to the customer on their order page and notification.
                </p>

                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PRESET_REASONS.map((preset) => {
                    const selected = reason.trim() === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setReason(preset)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors text-left cursor-pointer",
                          selected
                            ? "bg-gray-950 text-white border-gray-950"
                            : "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-100"
                        )}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  rows={3}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Write custom reason (Bangla or English)…"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 focus:border-black focus:ring-2 focus:ring-black/5 outline-none text-sm text-gray-900 placeholder:text-gray-400 resize-y"
                />
              </div>

              {canMarkRefunded && (
                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200/80 cursor-pointer">
                  <div>
                    <p className="text-xs font-semibold text-gray-900">
                      Also mark payment as Refunded
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Enable if you have already refunded the customer&apos;s payment.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={markRefunded}
                    onChange={(e) => setMarkRefunded(e.target.checked)}
                    className="w-4 h-4 rounded accent-black cursor-pointer shrink-0"
                  />
                </label>
              )}

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !reason.trim()}
                  className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting && <Loader2 size={13} className="animate-spin" />}
                  {initialReason ? "Save Reason" : "Cancel Order"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
