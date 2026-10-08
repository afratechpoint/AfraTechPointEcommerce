import React from "react";
import type { Metadata, Viewport } from "next";


import { Inter } from "next/font/google";
import "./globals.css";
import { storage } from "@/lib/storage";
import ClientLayout from "@/components/ClientLayout";
import SettingsProvider from "@/components/SettingsProvider";
import { THEMES, ThemeId } from "@/lib/themes";
import { AuthProvider } from "@/contexts/AuthContext";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({ subsets: ["latin"], display: "swap" });

const defaultSettings = {
  storeName: "Afra Tech Point",
  logoUrl: "https://afratechpoint.shop/email-logo.png",
  contactEmail: "afratechpoint@gmail.com",
  contactPhone: "+880 1974-722102",
  contactAddress: "Dhaka, Bangladesh",
  shortDescription: "Your premium destination for the latest in cutting-edge electronics and smart home devices.",
  currencySymbol: "৳",
  themeId: "midnight" as ThemeId,
  announcementText: "",
  announcementActive: false,
  navLinks: [],
  socialLinks: [],
  footerProducts: [],
  footerCompany: [],
  banners: [],
  categories: [],
  paymentMethods: [
    { id: "1", name: "bKash", accountNumber: "", enabled: true },
    { id: "2", name: "Nagad", accountNumber: "", enabled: true },
    { id: "3", name: "Rocket", accountNumber: "", enabled: true },
  ],
  codEnabled: true,
  deliveryCharge: 0
};

import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  let settings: any = defaultSettings;
  try {
    const fetchedSettings = await storage.getSettings();
    if (fetchedSettings && !Array.isArray(fetchedSettings)) {
      settings = fetchedSettings;
    }
  } catch (e) {
    console.warn("[Layout Metadata] Failed to fetch settings, using defaults.");
  }

  // Safe host detection for admin subdomain
  let isAdminSubdomain = false;
  try {
    const headersList = await headers();
    const host = headersList.get('host') || "";
    isAdminSubdomain = host.startsWith('admin.');
  } catch (e) {
    // Silent fail for non-browser/build contexts
  }

  if (isAdminSubdomain) {
    return {
      title: "Admin Panel | " + settings.storeName,
      description: "Manage your store.",
      manifest: "/api/manifest/admin",
    };
  }

  const shopUrl = process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop";
  const logoImage = settings.logoUrl || `${shopUrl}/logo.png`;
  // Use a clean, cacheable version of the logo for OG (no ImageKit transforms that might be blocked)
  const ogImage = logoImage.startsWith("http") ? logoImage : `${shopUrl}${logoImage}`;
  const siteDescription =
    settings.shortDescription ||
    "Afra Tech Point - Your premier destination in Bangladesh for authentic smartphones, smartwatches, wireless earbuds, and cutting-edge tech gadgets with fast home delivery.";

  return {
    metadataBase: new URL(shopUrl),
    title: {
      default: `${settings.storeName} | Best Online Tech & Gadget Shop in Bangladesh`,
      template: `%s | ${settings.storeName}`,
    },
    description: siteDescription,
    keywords: [
      "Afra Tech Point",
      "AfraTechPoint",
      "afratechpoint.shop",
      "tech shop bangladesh",
      "gadget shop bd",
      "best online tech shop bangladesh",
      "smartwatch price in bd",
      "wireless earbuds bangladesh",
      "buy gadgets online dhaka",
      "genuine electronic accessories bd",
      "bluetooth headphones bangladesh",
      "আফরা টেক পয়েন্ট",
      "গ্যাজেট শপ বাংলাদেশ",
      "অনলাইন গ্যাজেট শপ",
    ],
    manifest: "/api/manifest/shop",
    icons: {
      icon: settings.logoUrl || "/logo.png",
      apple: settings.logoUrl || "/logo.png",
    },
    alternates: {
      canonical: "/",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      alternateLocale: ["bn_BD"],
      siteName: settings.storeName,
      title: `${settings.storeName} | Best Online Tech & Gadget Shop in Bangladesh`,
      description: siteDescription,
      url: shopUrl,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: settings.storeName,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${settings.storeName} | Best Online Tech & Gadget Shop in Bangladesh`,
      description: siteDescription,
      images: [ogImage],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let settings: any = defaultSettings;
  
  try {
    const fetchedSettings = await storage.getSettings();
    if (fetchedSettings && !Array.isArray(fetchedSettings) && Object.keys(fetchedSettings).length > 0) {
      settings = fetchedSettings;
    }
  } catch (e) {
    console.error("[RootLayout] Critical settings fetch error, falling back to static defaults.");
  }

  const themeId = (settings.themeId as ThemeId) || "midnight";
  const theme = THEMES[themeId] || THEMES.midnight;

  return (
    <html lang="en" className="bg-[#f9fafb] overscroll-y-none" suppressHydrationWarning>
      <head>
        <meta name="format-detection" content="telephone=no" />
        <link rel="preconnect" href="https://ik.imagekit.io" />
        <link rel="dns-prefetch" href="https://ik.imagekit.io" />
        
        {/* Preload the logo — very high priority */}
        {settings.logoUrl && (
          <link
            rel="preload"
            as="image"
            href={`${settings.logoUrl}${settings.logoUrl.includes('?') ? '&' : '?'}tr=w-300,f-auto,q-80`}
          />
        )}
        {/* Preload the first hero banner image — eliminates LCP discovery delay */}
        {settings.banners?.[0]?.imageUrl && (
          <link
            rel="preload"
            as="image"
            href={`${settings.banners[0].imageUrl}${settings.banners[0].imageUrl.includes('?') ? '&' : '?'}tr=w-800,f-auto,q-80`}
          />
        )}
        {/* Structured Data (JSON-LD) for Search Engines */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: settings.storeName || "Afra Tech Point",
                alternateName: ["AfraTechPoint", "আফরা টেক পয়েন্ট"],
                url: process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop",
                description: settings.shortDescription,
                potentialAction: {
                  "@type": "SearchAction",
                  target: {
                    "@type": "EntryPoint",
                    urlTemplate: `${process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop"}/shop?q={search_term_string}`,
                  },
                  "query-input": "required name=search_term_string",
                },
              },
              {
                "@context": "https://schema.org",
                "@type": "Store",
                name: settings.storeName || "Afra Tech Point",
                url: process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop",
                logo: settings.logoUrl || `${process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop"}/logo.png`,
                image: settings.logoUrl || `${process.env.NEXT_PUBLIC_SHOP_URL || "https://afratechpoint.shop"}/logo.png`,
                description: settings.shortDescription,
                telephone: settings.contactPhone,
                email: settings.contactEmail,
                address: {
                  "@type": "PostalAddress",
                  addressCountry: "BD",
                  addressLocality: "Dhaka",
                  streetAddress: settings.contactAddress || "Dhaka, Bangladesh",
                },
                priceRange: "৳৳",
                currenciesAccepted: "BDT",
                paymentAccepted: "Cash on Delivery, bKash, Nagad, Rocket",
              },
            ]),
          }}
        />
        <style
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --primary: ${theme.primary};
                --primary-hover: ${theme.hover};
                --primary-text: ${theme.text};
                --primary-accent: ${theme.accent};
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.className} min-h-[100dvh] bg-[#f9fafb] overscroll-y-none overflow-x-hidden`} suppressHydrationWarning>
        <AuthProvider>
          <SettingsProvider initialSettings={settings}>
            {settings.announcementActive && settings.announcementText && (
              <div 
                className="w-full text-center py-2 px-4 shadow-sm text-xs font-bold z-[110] relative transition-colors duration-500"
                style={{ 
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-text)' 
                }}
              >
                {settings.announcementText}
              </div>
            )}
            <ClientLayout>
              <div id="main-content" className="w-full">
                {children}
              </div>
            </ClientLayout>
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
