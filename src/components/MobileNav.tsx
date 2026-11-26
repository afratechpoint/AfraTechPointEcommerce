"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Store, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/contexts/AuthContext";

export default function MobileNav() {
  const pathname  = usePathname();
  const { items } = useCart();
  const { user }  = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const cartCount = mounted ? items.reduce((sum, item) => sum + item.quantity, 0) : 0;

  const tabs = [
    { label: "Home", icon: Home, href: "/", active: pathname === "/" },
    { label: "Shop", icon: Store, href: "/shop", active: pathname.startsWith("/shop") },
    { label: "Cart", icon: ShoppingBag, href: "/cart", active: pathname === "/cart", badge: cartCount },
    {
      label: "Account",
      icon: User,
      href: mounted && user ? "/account" : "/login",
      active: pathname.startsWith("/account") || pathname === "/login" || pathname === "/register",
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed inset-x-0 bottom-0 z-[500] md:hidden border-t border-gray-200/80 bg-white/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.18)]"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 h-[62px]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[9px] font-black uppercase tracking-wider transition-colors",
                tab.active ? "text-black" : "text-gray-400 hover:text-gray-700"
              )}
            >
              {tab.active && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-black" />
              )}
              <span
                className={cn(
                  "relative w-9 h-7 rounded-full flex items-center justify-center transition-all",
                  tab.active && "bg-gray-100"
                )}
              >
                <Icon size={19} strokeWidth={tab.active ? 2.6 : 2} />
                {typeof tab.badge === "number" && tab.badge > 0 && (
                  <span className="absolute -top-0.5 right-0 min-w-[15px] h-[15px] px-0.5 rounded-full bg-black text-white text-[8px] font-black flex items-center justify-center border border-white">
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
