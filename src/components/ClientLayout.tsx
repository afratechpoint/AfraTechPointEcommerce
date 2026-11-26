"use client";

import React, { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useUI } from "@/lib/ui";
import { useSettings } from "@/components/SettingsProvider";
import { useCart } from "@/lib/cart";
import { useRealtime } from "@/lib/realtime-client";
import MobileNav from "@/components/MobileNav";
import { Toaster } from "sonner";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import NavigationObserver from "@/components/NavigationObserver";
import PremiumLoader from "@/components/PremiumLoader";
import PushNotificationManager from "@/components/PushNotificationManager";

/**
 * Global client-only UI (toasts, mobile nav, route loader, push manager).
 *
 * IMPORTANT: this component deliberately does NOT accept `children`.
 * Server-rendered children must be rendered directly by the server layout as
 * a sibling. Passing them through a Client Component makes Next's generated
 * Suspense boundary land in a different position in the SSR HTML vs the
 * client tree, which causes a hydration mismatch on suspending routes.
 */
export default function ClientLayout() {
  const { isLoading } = useUI();
  const settings = useSettings();
  const pathname = usePathname();
  const syncCatalog = useCart((s) => s.syncCatalog);

  const refreshCartPrices = useCallback(() => {
    if (useCart.getState().items.length === 0) return;
    fetch("/api/products", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) syncCatalog(data);
      })
      .catch(() => {});
  }, [syncCatalog]);

  useRealtime("products", refreshCartPrices);

  const isAuthPage = ['/login', '/register', '/reset-password', '/verify-email'].includes(pathname);
  const isAdminPage = pathname.startsWith('/admin');
  const hideMobileNav = isAuthPage || isAdminPage;

  return (
    <>
      {settings.announcementActive && settings.announcementText && (
        <div
          className="w-full text-center py-2 px-4 shadow-sm text-xs font-bold z-[110] relative transition-colors duration-500"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-text)" }}
        >
          {settings.announcementText}
        </div>
      )}
      <NavigationObserver />
      <AnimatePresence>
        {isLoading && <PremiumLoader />}
      </AnimatePresence>
      <PushNotificationManager />
      <Toaster
        position="top-center"
        expand={false}
        offset={{ top: 18 }}
        icons={{
          success: <CheckCircle2 size={16} className="text-emerald-400" strokeWidth={2.4} />,
          error: <AlertCircle size={16} className="text-red-400" strokeWidth={2.4} />,
          warning: <AlertTriangle size={16} className="text-amber-400" strokeWidth={2.4} />,
          info: <Info size={16} className="text-gray-300" strokeWidth={2.4} />,
          loading: <Loader2 size={16} className="text-white animate-spin" strokeWidth={2.4} />,
        }}
        toastOptions={{
          duration: 2600,
        }}
      />
      {!hideMobileNav && <MobileNav />}
    </>
  );
}
