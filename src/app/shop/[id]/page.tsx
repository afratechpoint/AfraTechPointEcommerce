// ── Product Detail Page — Server Wrapper ──────────────────────
// This server component exists solely to generate dynamic OG/Twitter
// metadata for each product, so that Facebook, WhatsApp, Twitter, etc.
// can show the product image and title when the link is shared.
//
// The actual UI is rendered by ProductDetailClient (a client component).

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Suspense } from "react";
import ProductDetailClient from "./ProductDetailClient";
import PremiumLoader from "@/components/PremiumLoader";
import { storage } from "@/lib/storage";
import { isProductOutOfStock, sanitizePublicProduct } from "@/lib/inventory";
import { getAppUrl } from "@/lib/app-url";

const SHOP_URL = getAppUrl();

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const product = await storage.getProductById(id);
    if (!product) throw new Error("Not found");

    const title = product.name || "Product";
    const settings = await storage.getSettings();
    const siteName = settings.storeName || "Afra Tech Point";

    const description =
      product.description?.substring(0, 160) ||
      `Buy ${product.name} at the best price.`;
    const price =
      product.salePrice ?? product.regularPrice ?? product.price ?? 0;
    const currency = "BDT";

    // Use the raw product image URL for OG — ensuring it's absolute
    let imageUrl = product.image;
    if (imageUrl && !imageUrl.startsWith("http")) {
       // Combine with shop URL if it's relative
       imageUrl = `${SHOP_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
    }
    if (!imageUrl) imageUrl = `${SHOP_URL}/logo.png`;

    return {
      title: `${title} | ${siteName}`,
      description,
      keywords: [
        title,
        `${title} price in bangladesh`,
        `${title} bd`,
        product.category || "Gadgets",
        "Afra Tech Point",
        "buy online bangladesh",
        "authentic gadgets bd",
      ],
      alternates: {
        canonical: `${SHOP_URL}/shop/${id}`,
      },
      openGraph: {
        type: "website",
        siteName,
        title: `${title} | ${siteName}`,
        description,
        url: `${SHOP_URL}/shop/${id}`,
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: title,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: `${title} | ${siteName}`,
        description,
        images: [imageUrl],
      },
      other: {
        // Rich product snippet for Facebook / WhatsApp / Google
        "og:price:amount": String(price),
        "og:price:currency": currency,
      },
    };
  } catch (err) {
    console.error("[generateMetadata] Error:", err);
    // Fallback metadata if product lookup fails
    return {
      title: "Product | Afra Tech Point",
      description: "Shop electronics at Afra Tech Point.",
      alternates: {
        canonical: `${SHOP_URL}/shop/${id}`,
      },
      openGraph: {
        title: "Afra Tech Point",
        description: "Shop electronics at Afra Tech Point.",
        images: [`${SHOP_URL}/logo.png`],
      },
    };
  }
}

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params;
  let product: any = null;
  try {
    product = await storage.getProductById(id);
  } catch (e) {
    // Client component handles not found state gracefully
  }

  let jsonLd: any = null;
  let breadcrumbLd: any = null;

  if (product) {
    const price = product.salePrice ?? product.regularPrice ?? product.price ?? 0;
    const isOutOfStock = isProductOutOfStock(product);
    let mainImage = product.image || `${SHOP_URL}/logo.png`;
    if (mainImage && !mainImage.startsWith("http")) {
      mainImage = `${SHOP_URL}${mainImage.startsWith("/") ? "" : "/"}${mainImage}`;
    }

    const allImages: string[] = [mainImage];
    if (Array.isArray(product.images)) {
      product.images.forEach((img: string) => {
        if (img) {
          const fullImg = img.startsWith("http") ? img : `${SHOP_URL}${img.startsWith("/") ? "" : "/"}${img}`;
          if (!allImages.includes(fullImg)) allImages.push(fullImg);
        }
      });
    }

    jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      image: allImages,
      description: product.description || `Buy ${product.name} at Afra Tech Point Bangladesh.`,
      sku: product.id,
      brand: {
        "@type": "Brand",
        name: product.brand || "Afra Tech Point",
      },
      offers: {
        "@type": "Offer",
        url: `${SHOP_URL}/shop/${id}`,
        priceCurrency: "BDT",
        price: Number(price),
        priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        itemCondition: "https://schema.org/NewCondition",
        availability: isOutOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        seller: {
          "@type": "Organization",
          name: "Afra Tech Point",
        },
      },
    };

    breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: SHOP_URL,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Shop",
          item: `${SHOP_URL}/shop`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: product.category || "Gadgets",
          item: `${SHOP_URL}/shop?category=${encodeURIComponent(product.category || "All")}`,
        },
        {
          "@type": "ListItem",
          position: 4,
          name: product.name,
          item: `${SHOP_URL}/shop/${id}`,
        },
      ],
    };
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {breadcrumbLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
        />
      )}
      <Suspense fallback={<PremiumLoader />}>
        <ProductDetailClient
          initialProduct={product ? JSON.parse(JSON.stringify(sanitizePublicProduct(product))) : null}
        />
      </Suspense>
    </>
  );
}
