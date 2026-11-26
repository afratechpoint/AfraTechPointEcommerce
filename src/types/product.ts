// Shared product taxonomy: Physical vs Virtual goods.

export type ProductKind = "physical" | "virtual";

export type VirtualType = "social" | "account" | "license" | "software";

export type VirtualStockMode = "pool" | "quantity" | "unlimited" | "out_of_stock";

export interface Credential {
  id: string;
  email: string;
  password: string;
  note?: string;
  variantName?: string;
}

export interface LicenseKey {
  id: string;
  key: string;
  note?: string;
  variantName?: string;
}

/** Admin-defined input shown on a Social Growth product page. */
export interface VirtualCustomField {
  id: string;
  label: string;
  placeholder: string;
}

export interface VirtualConfig {
  /** Shown to the customer on the product page and in their order. */
  instructions?: string;
  /** e.g. "Within 30 minutes" */
  estimatedDelivery?: string;
  /** Controls how inventory availability is determined for this virtual product. */
  stockMode?: VirtualStockMode;
  /** Account-type products (OTT etc.) — one entry is consumed per order when stockMode === "pool". */
  credentialPool?: Credential[];
  /** License-type products — one entry is consumed per order when stockMode === "pool". */
  licensePool?: LicenseKey[];
  /** Publicly safe pool counts populated when stripping sensitive credentials/keys for storefront. */
  poolCount?: number;
  variantPoolCounts?: Record<string, number>;
  /** Software-type products — external direct download URL (Drive etc.). */
  downloadUrl?: string;
  version?: string;
  fileSize?: string;
  /** Social-type products — extra required inputs on the product page. */
  customFields?: VirtualCustomField[];
}

export const VIRTUAL_TYPE_LABELS: Record<VirtualType, string> = {
  social: "Social Growth (Page / Account URL)",
  account: "Account Provide (ID & Password)",
  license: "License Key",
  software: "Software Download (ZIP / File)",
};

/** Treat legacy products (no productKind) as physical. */
export function isVirtual(product?: { productKind?: ProductKind } | null): boolean {
  return product?.productKind === "virtual";
}
