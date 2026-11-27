import React from "react";
import type { Metadata, Viewport } from "next";


import { Inter } from "next/font/google";
import "./globals.css";
import ClientLayout from "@/components/ClientLayout";
import SettingsProvider from "@/components/SettingsProvider";
import { THEMES, ThemeId } from "@/lib/themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { getAppUrl } from "@/lib/app-url";
import { safeJsonLdStringify } from "@/lib/security/validation";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({ subsets: ["latin"], display: "swap" });

const defaultSettings = {
  storeName: "Afra Tech Point",
  logoUrl: "/logo.png",
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

export function generateMetadata(): Metadata {
  // Synchronous on purpose: an async root metadata function makes Next stream
  // a Suspense boundary into the HTML, which breaks hydration matching.
  const settings: any = defaultSettings;

  const shopUrl = getAppUrl();
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Keep the root layout synchronous. Awaiting Firestore here made the whole
  // tree suspend during SSR, which produced a streamed Suspense boundary in
  // the HTML that didn't match the client tree -> hydration mismatch.
  // Live settings are loaded by SettingsProvider on the client instead.
  const settings: any = defaultSettings;

  const themeId = (settings.themeId as ThemeId) || "midnight";
  const theme = THEMES[themeId] || THEMES.midnight;
  const shopUrl = getAppUrl();

  return (
    <html lang="en" className="bg-[#f9fafb]" suppressHydrationWarning>
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
            __html: safeJsonLdStringify([
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: settings.storeName || "Afra Tech Point",
                alternateName: ["AfraTechPoint", "আফরা টেক পয়েন্ট"],
                url: shopUrl,
                description: settings.shortDescription,
                potentialAction: {
                  "@type": "SearchAction",
                  target: {
                    "@type": "EntryPoint",
                    urlTemplate: `${shopUrl}/shop?q={search_term_string}`,
                  },
                  "query-input": "required name=search_term_string",
                },
              },
              {
                "@context": "https://schema.org",
                "@type": "Store",
                name: settings.storeName || "Afra Tech Point",
                url: shopUrl,
                logo: settings.logoUrl || `${shopUrl}/logo.png`,
                image: settings.logoUrl || `${shopUrl}/logo.png`,
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
      <body className={`${inter.className} min-h-[100dvh] bg-[#f9fafb]`} suppressHydrationWarning>
        <AuthProvider>
          <SettingsProvider initialSettings={settings}>
            <ClientLayout />
            <div id="main-content" className="w-full pb-20 md:pb-0">
              {children}
            </div>
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
