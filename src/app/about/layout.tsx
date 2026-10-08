import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Us | Afra Tech Point",
  description:
    "Learn about Afra Tech Point - Bangladesh's trusted online destination for authentic tech products, innovative gadgets, and customer-first support.",
  alternates: {
    canonical: "/about",
  },
  openGraph: {
    title: "About Us | Afra Tech Point",
    description:
      "Learn about Afra Tech Point - Bangladesh's trusted online destination for authentic tech products and innovative gadgets.",
    url: "/about",
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
