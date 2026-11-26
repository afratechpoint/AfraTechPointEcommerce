import type { Metadata } from "next";

// Always render the shop on demand so category/pricing changes and layout
// fixes aren't stuck in a cached static payload.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Products & Gadgets | Afra Tech Point",
  description:
    "Explore authentic wireless earbuds, smartwatches, power banks, and modern electronic accessories at Afra Tech Point. Best prices in Bangladesh with fast cash on delivery.",
  keywords: [
    "buy tech gadgets bd",
    "smartwatch price in bangladesh",
    "wireless earbuds shop",
    "electronics store dhaka",
    "afra tech point shop",
    "online gadget shop bangladesh",
  ],
  alternates: {
    canonical: "/shop",
  },
  openGraph: {
    title: "All Products & Gadgets | Afra Tech Point",
    description:
      "Explore authentic wireless earbuds, smartwatches, power banks, and modern electronic accessories at Afra Tech Point.",
    url: "/shop",
  },
};

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
