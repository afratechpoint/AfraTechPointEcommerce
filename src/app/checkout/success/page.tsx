"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/components/SettingsProvider";
import PremiumLoader from "@/components/PremiumLoader";

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
  variantName?: string;
}

interface Order {
  id: string;
  total?: number;
  totalAmount?: number;
  paymentStatus?: string;
  payment?: { method?: string; transactionId?: string; senderNumber?: string };
  paymentDetails?: { method?: string; transactionId?: string; senderNumber?: string };
  items: OrderItem[];
}

function CheckoutSuccessContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId") ?? "";
  const { user } = useAuth();
  const settings = useSettings() as any;
  const currency = settings?.currencySymbol ?? "৳";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const token = await user?.getIdToken();
        const r = await fetch(`/api/orders/${orderId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (r.ok) {
          setOrder(await r.json());
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [orderId, user]);

  if (loading) return <PremiumLoader />;

  const trxId = order?.payment?.transactionId ?? order?.paymentDetails?.transactionId ?? "";
  const pmtMethod = order?.payment?.method ?? order?.paymentDetails?.method ?? "";
  const total = order?.totalAmount ?? order?.total ?? 0;
  const isCOD = pmtMethod === "Cash on Delivery";

  return (
    <div className="flex flex-col min-h-screen bg-white text-gray-900">
      <Navbar searchEnabled={false} />

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md border border-gray-200 rounded-2xl p-6 sm:p-7 bg-white">
          <div className="w-11 h-11 rounded-full bg-black text-white flex items-center justify-center mx-auto mb-4">
            <Check size={20} strokeWidth={2.5} />
          </div>

          <h1 className="text-xl font-bold text-gray-900 text-center">Order Placed</h1>
          <p className="text-xs sm:text-sm text-gray-500 text-center mt-1 mb-5">
            {isCOD
              ? "Your order has been received and will be prepared shortly."
              : "We have received your order and will verify your payment shortly."}
          </p>

          {orderId && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 mb-4 text-center">
              <p className="text-[11px] font-medium text-gray-500">Order ID</p>
              <p className="text-sm font-bold text-gray-900 font-mono break-all mt-0.5">
                #{orderId.slice(0, 12).toUpperCase()}
              </p>
            </div>
          )}

          {!isCOD && trxId && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 mb-4 text-xs text-gray-600 leading-relaxed">
              Payment via <span className="font-semibold text-gray-900">{pmtMethod}</span> · TrxID:{" "}
              <span className="font-mono font-semibold text-gray-900 break-all">{trxId}</span>
            </div>
          )}

          {order && order.items?.length > 0 && (
            <div className="mb-5 space-y-2 border-t border-gray-100 pt-4">
              {order.items.map((item, i) => (
                <div key={i} className="flex justify-between gap-3 text-xs sm:text-sm">
                  <span className="text-gray-600 truncate">
                    {item.name} × {item.quantity}
                  </span>
                  <span className="font-semibold text-gray-900 tabular-nums shrink-0">
                    {currency}
                    {(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-gray-900 text-sm pt-2 border-t border-gray-100">
                <span>Total</span>
                <span className="tabular-nums">
                  {currency}
                  {Number(total).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <Link
              href={orderId ? `/account/orders/${orderId}` : "/account?tab=orders"}
              className="w-full h-10 bg-black text-white rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
            >
              Track Order <ArrowRight size={14} />
            </Link>
            <Link
              href="/shop"
              className="w-full h-10 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center hover:border-black hover:text-black transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<PremiumLoader />}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}
