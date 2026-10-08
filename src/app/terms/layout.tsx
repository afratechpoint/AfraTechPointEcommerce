import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service & Policies | Afra Tech Point",
  description:
    "Read the terms of service, warranty, replacement and delivery policies of Afra Tech Point.",
  alternates: {
    canonical: "/terms",
  },
  openGraph: {
    title: "Terms of Service & Policies | Afra Tech Point",
    description:
      "Read the terms of service, warranty, replacement and delivery policies of Afra Tech Point.",
    url: "/terms",
  },
};

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
