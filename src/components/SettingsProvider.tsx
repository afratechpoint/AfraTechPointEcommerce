"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { THEMES, ThemeId } from "@/lib/themes";
import { useRealtime } from "@/lib/realtime-client";

export interface LinkItem {
  id: string;
  label: string;
  href: string;
}

export interface SocialLink {
  id: string;
  platform: string;
  url: string;
}

export interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
}

export interface CategoryItem {
  id: string;
  label: string;
  slug: string;
}

export { THEMES };
export type { ThemeId };

export interface Settings {
  storeName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  shortDescription: string;
  currencySymbol: string;
  themeId: ThemeId;
  announcementText: string;
  announcementActive: boolean;
  businessHours: string;
  signatureUrl?: string;
  signatureName?: string;
  navLinks: LinkItem[];
  socialLinks: SocialLink[];
  footerProducts: LinkItem[];
  footerCompany: LinkItem[];
  banners: BannerItem[];
  categories: CategoryItem[];
}

const SettingsContext = createContext<Settings | null>(null);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};

export default function SettingsProvider({
  children,
  initialSettings,
}: {
  children: React.ReactNode;
  initialSettings: Settings;
}) {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  // The root layout is synchronous to avoid SSR suspense/hydration mismatches.
  // Load the real store settings on the client after mount.
  const loadSettings = useCallback(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data || Array.isArray(data) || Object.keys(data).length === 0) return;
        setSettings(prev => ({ ...prev, ...data, themeId: "midnight" }));
        const theme = THEMES.midnight;
        const root = document.documentElement;
        root.style.setProperty("--primary", theme.primary);
        root.style.setProperty("--primary-hover", theme.hover);
        root.style.setProperty("--primary-text", theme.text);
        root.style.setProperty("--primary-accent", theme.accent);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useRealtime("settings", loadSettings);

  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}
