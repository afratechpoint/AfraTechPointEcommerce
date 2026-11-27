"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Search, ShoppingBag, Menu, X, User, LogOut, Settings, ChevronDown, LayoutDashboard, ChevronRight, ShoppingCart, ArrowLeft, Home, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import { useSettings } from "@/components/SettingsProvider";
import { useAuth } from "@/contexts/AuthContext";
import ShopNotificationBell from "@/components/ShopNotificationBell";

interface NavbarProps {
  searchEnabled?: boolean;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
}

export default function Navbar({ 
  searchEnabled = false, 
  searchQuery = "", 
  setSearchQuery
}: NavbarProps) {
  const pathname  = usePathname();
  const router    = useRouter();
  const { items, removeItem } = useCart();
  const isAuthPage = ['/login', '/register', '/reset-password', '/verify-email'].includes(pathname);
  const settings  = useSettings();
  const { user, loading, isAdmin, logout, displayName, photoURL } = useAuth();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const navLinks  = settings.navLinks || [];

  // ── User dropdown state ─────────────────────────────────────────
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await logout();
    router.push("/");
  };

  // Derived display values from Context
  const initials    = (displayName || user?.email || "A")[0].toUpperCase();
  const finalDisplayName = displayName || (user?.email?.split("@")[0] ?? "Account");

  return (
    <nav className="w-full border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-[100] transition-all pt-safe">
      {/* ── Mobile top bar ── */}
      <div className="flex md:hidden items-center justify-between h-16 px-4 bg-white/95 border-b border-gray-100">
        <Link href="/" className="shrink-0 relative h-14 w-40 flex items-center" aria-label={`${settings.storeName} Home`}>
          <Image 
            src={settings.logoUrl ? `${settings.logoUrl}${settings.logoUrl.includes('?') ? '&' : '?'}tr=w-500,f-auto,q-90` : "/logo.png"} 
            alt={`${settings.storeName} Logo`} 
            fill
            loading="eager"
            fetchPriority="high"
            unoptimized={true}
            sizes="160px"
            className="object-contain object-left mix-blend-multiply" 
          />
        </Link>
        {!isAuthPage && (
          <div className="flex items-center gap-2">
            <ShopNotificationBell />
            <Link
              href="/cart"
              aria-label={`View shopping cart with ${cartCount} items`}
              className="p-2.5 rounded-full bg-gray-100/80 text-gray-900 hover:bg-gray-200 transition-all relative active:scale-95"
            >
              <ShoppingBag size={18} strokeWidth={2.3} aria-hidden="true" />
              {mounted && cartCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-black text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white px-0.5">
                  {cartCount > 9 ? "9+" : cartCount}
                </span>
              )}
            </Link>
          </div>
        )}
      </div>

      {/* Mobile & Tablet search bar */}
      {searchEnabled && (
        <div className="lg:hidden px-4 py-2.5 bg-white border-b border-gray-100">
          <div className="relative max-w-xl mx-auto">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search products…"
              aria-label="Search products"
              value={searchQuery}
              onChange={(e) => setSearchQuery?.(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-full bg-gray-100/80 border border-gray-200/50 outline-none text-xs text-gray-900 placeholder:text-gray-400 font-medium focus:bg-white focus:ring-2 focus:ring-black transition-all"
            />
          </div>
        </div>
      )}

      {/* ── Desktop full nav (3-column grid keeps menu links dead-center on all pages) ── */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1fr] w-full max-w-[1800px] mx-auto h-20 items-center gap-4 px-4 sm:px-6 md:px-8 lg:px-12">

        {/* ── Left: Logo ─────────────────────────────────────────── */}
        <div className="flex items-center justify-self-start shrink-0">
          <Link href="/" className="shrink-0 relative h-[72px] w-48 lg:w-56 flex items-center" aria-label={`${settings.storeName} Home`}>
            <Image 
              src={settings.logoUrl ? `${settings.logoUrl}${settings.logoUrl.includes('?') ? '&' : '?'}tr=w-500,f-auto,q-90` : "/logo.png"} 
              alt={`${settings.storeName} Logo`} 
              fill
              loading="eager"
              fetchPriority="high"
              unoptimized={true}
              sizes="224px"
              className="object-contain object-left mix-blend-multiply" 
            />
          </Link>
        </div>

        {/* ── Center: Navigation Links ───────────────────────────── */}
        <div className="flex items-center justify-center justify-self-center gap-6 lg:gap-9">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.id || link.label}
                href={link.href}
                className={cn(
                  "group text-[11px] font-black uppercase tracking-[0.14em] transition-colors relative py-1 whitespace-nowrap",
                  isActive ? "text-black" : "text-gray-500 hover:text-black"
                )}
              >
                {link.label}
                <span
                  className={cn(
                    "absolute -bottom-0.5 left-0 h-[2px] bg-black transition-all duration-200",
                    isActive ? "w-full" : "w-0 group-hover:w-full"
                  )}
                />
              </Link>
            );
          })}
        </div>

        {/* ── Right: Search + Notifications + Cart + Auth ────────── */}
        <div className="flex items-center gap-2.5 lg:gap-3 shrink-0 justify-end justify-self-end">
          {searchEnabled && (
            <div className="relative group w-44 xl:w-56 hidden lg:block">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-black transition-colors pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search products…"
                aria-label="Search products"
                value={searchQuery}
                onChange={(e) => setSearchQuery?.(e.target.value)}
                className="w-full h-9 pl-9 pr-3.5 rounded-full bg-gray-100/80 hover:bg-gray-100 focus:bg-white border border-transparent focus:border-gray-200 outline-none text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-black transition-all"
              />
            </div>
          )}

          {/* Notifications */}
          <ShopNotificationBell />

          {/* Cart button */}
          <Link
            href="/cart"
            aria-label={`View shopping cart with ${cartCount} items`}
            className="p-2.5 rounded-full bg-gray-100/80 hover:bg-gray-200 text-gray-900 transition-all relative group"
          >
            <ShoppingBag size={18} strokeWidth={2.3} aria-hidden="true" />
            {mounted && cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 flex items-center justify-center rounded-full border-2 border-white bg-black text-white text-[9px] font-black">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>

          {/* ── Auth section ─────────────────────────────────────── */}
          <div className="flex items-center pl-3 border-l border-gray-200">

            {/* Loading skeleton */}
            {loading && (
              <div className="flex items-center gap-2 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-gray-100" />
                <div className="w-16 h-3 rounded bg-gray-100 hidden xl:block" />
              </div>
            )}

            {/* ── LOGGED IN: Avatar + Name + Dropdown ── */}
            {!loading && user && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen((o) => !o)}
                  aria-haspopup="true"
                  aria-expanded={dropdownOpen}
                  aria-label="User Account Menu"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-gray-100 transition-all group"
                >
                  {/* Avatar */}
                  {photoURL && !imgError ? (
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-gray-200 shadow-sm shrink-0">
                      <Image 
                        src={photoURL} 
                        alt="" 
                        width={28} 
                        height={28} 
                        className="object-cover" 
                        unoptimized 
                        onError={() => setImgError(true)}
                      />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center shrink-0">
                      <span className="text-white text-[11px] font-black" aria-hidden="true">{initials}</span>
                    </div>
                  )}

                  {/* Name (visible on xl+ screens) */}
                  <div className="hidden xl:block text-left">
                    <p className="text-[11px] font-black text-gray-900 tracking-tight leading-none truncate max-w-[100px]">
                      {finalDisplayName}
                    </p>
                  </div>

                  <ChevronDown
                    size={13}
                    aria-hidden="true"
                    className={`text-gray-400 transition-transform hidden xl:block ${dropdownOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {/* Dropdown menu */}
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-gray-100 shadow-xl shadow-gray-200/50 overflow-hidden z-50">
                    {/* User info header */}
                    <div className="px-4 py-3 border-b border-gray-50 bg-gray-50/50">
                      <p className="text-[11px] font-black text-gray-900 truncate">{finalDisplayName}</p>
                      <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">{user.email}</p>
                    </div>

                    {/* Menu items */}
                    <Link
                      href="/account"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 hover:text-black transition-colors"
                    >
                      <User size={14} /> My Account
                    </Link>

                    {isAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 hover:text-black transition-colors"
                      >
                        <Settings size={14} /> Admin Panel
                      </Link>
                    )}

                    <div className="border-t border-gray-50" />

                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={14} /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── LOGGED OUT: Sign In + Register ── */}
            {!loading && !user && (
              <div className="flex items-center gap-3">
                <Link
                  href="/login"
                  className="text-xs font-bold text-gray-600 hover:text-black uppercase tracking-wider transition-colors px-2 py-1"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="h-8.5 px-4 rounded-xl bg-black text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center hover:bg-gray-800 transition-all shadow-sm hover:scale-105 active:scale-95"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
