// ── Admin Panel: Shared TypeScript Types ──────────────────────────
// Single source of truth for product-related types in the admin panel.

import type { ProductKind, VirtualType, VirtualConfig } from "@/types/product";

export interface Variant {
  id: string;
  name: string;
  regularPrice?: number;
  salePrice?: number;
  image?: string;
  /** If true, this variant inherits the main product price */
  useMainPrice?: boolean;
  /** Optional per-variant stock managed in /admin/inventory */
  stock?: number | null;
}

export interface Specification {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  name: string;
  /** Full / regular price */
  regularPrice: number;
  /** Sale price — when present it is the active selling price */
  salePrice?: number;
  /** @deprecated Use regularPrice */
  price?: number;
  category: string;
  /** Main (hero) image URL */
  image: string;
  /** Extra gallery images */
  gallery?: string[];
  /** Short "About This Item" blurb */
  aboutItem?: string;
  /** Full product description */
  description: string;
  /** Key-value specification pairs */
  specifications?: Specification[];
  /** Product variants (colours, storage sizes, models…) */
  variants?: Variant[];
  /** Total stock available */
  stock?: number | null;
  /** Rating out of 5 */
  rating?: number;
  /** SEO & related product tags */
  tags?: string[];

  /** physical (default for legacy products) or virtual */
  productKind?: ProductKind;
  /** Set when productKind === "virtual" */
  virtualType?: VirtualType;
  /** Type-specific virtual product configuration */
  virtualConfig?: VirtualConfig;
}
