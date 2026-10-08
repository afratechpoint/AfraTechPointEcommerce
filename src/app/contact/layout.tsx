import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact Us & Support | Afra Tech Point",
  description:
    "Get in touch with Afra Tech Point. Have inquiries about gadgets, order status, or need customer assistance? We are here to help.",
  alternates: {
    canonical: "/contact",
  },
  openGraph: {
    title: "Contact Us & Support | Afra Tech Point",
    description:
      "Get in touch with Afra Tech Point for customer support, product inquiries, and assistance.",
    url: "/contact",
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
