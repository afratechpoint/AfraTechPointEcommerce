"use client";

import React, { useState, useEffect } from "react";
import { Menu, X, SpellCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import NotificationBell from "./NotificationBell";
import {
  getSpellCheckEnabled,
  setSpellCheckEnabled,
  SPELLCHECK_TOGGLE_EVENT,
} from "./AdminSpellChecker";
import { cn } from "@/lib/utils";

interface AdminHeaderProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const pageTitles: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/orders": "Orders",
  "/admin/products": "Products",
  "/admin/virtual-products": "Virtual Products",
  "/admin/inventory": "Inventory",
  "/admin/customers": "Customers",
  "/admin/notifications": "Notifications",
  "/admin/media": "Media Library",
  "/admin/shop": "Shop Config",
  "/admin/settings": "Settings",
};

export default function AdminHeader({ isOpen, setIsOpen }: AdminHeaderProps) {
  const pathname = usePathname() ?? "";
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/admin/orders/")
      ? "Order Details"
      : pathname.startsWith("/admin/virtual-products/")
      ? "Virtual Products"
      : pathname.startsWith("/admin/products/")
      ? "Products"
      : "Admin Panel");
  const [spellEnabled, setSpellEnabledState] = useState(true);

  useEffect(() => {
    setSpellEnabledState(getSpellCheckEnabled());
    const onToggle = (e: Event) => {
      setSpellEnabledState((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener(SPELLCHECK_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(SPELLCHECK_TOGGLE_EVENT, onToggle);
  }, []);

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 h-16 bg-white border-b border-gray-100 sticky top-0 z-[60] shadow-sm w-full">
      {/* Mobile & Tablet Toggle + Branding */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="lg:hidden p-2 bg-gray-50 text-black rounded-xl border border-gray-100 hover:bg-gray-100 active:scale-95 transition-all focus:outline-none"
          aria-label="Toggle navigation menu"
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="flex items-center gap-2 lg:hidden">
          <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm">A</div>
          <span className="font-bold text-base tracking-tighter">Admin.</span>
        </div>

        {/* Desktop Title */}
        <h2 className="hidden lg:block font-bold text-xl tracking-tight text-gray-800">{title}</h2>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Active Page Indicator on smaller screens */}
        <span className="text-xs font-semibold text-gray-400 hidden sm:inline-block mr-1 lg:hidden">
          {title}
        </span>

        {/* Grammarly-style Spell Checker Toggle */}
        <button
          type="button"
          onClick={() => setSpellCheckEnabled(!spellEnabled)}
          title={spellEnabled ? "Spell Check is ON (click to turn off)" : "Spell Check is OFF (click to turn on)"}
          className={cn(
            "h-9 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer",
            spellEnabled
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/80"
              : "bg-gray-50 border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          )}
        >
          <SpellCheck size={15} />
          <span className="hidden sm:inline">Spell Check</span>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              spellEnabled ? "bg-emerald-500" : "bg-gray-300"
            )}
          />
        </button>

        <NotificationBell />
      </div>
    </header>
  );
}
