import type { VirtualConfig, VirtualStockMode, VirtualType } from "@/types/product";

export interface StockableVariant {
  id?: string;
  name: string;
  stock?: number | null;
  regularPrice?: number;
  salePrice?: number;
  image?: string;
  useMainPrice?: boolean;
}

export interface StockableProduct {
  id: string;
  name: string;
  stock?: number | null;
  variants?: StockableVariant[];
  productKind?: "physical" | "virtual" | string;
  virtualType?: VirtualType | string;
  virtualConfig?: VirtualConfig;
}

/**
 * Resolves the active stock mode for a virtual product, preserving backwards compatibility
 * with products created before dedicated inventory management.
 */
export function resolveVirtualStockMode(product: StockableProduct): VirtualStockMode {
  const cfg = product.virtualConfig;
  if (cfg?.stockMode) return cfg.stockMode;

  if (product.virtualType === "license") {
    if (Array.isArray(cfg?.licensePool) && cfg!.licensePool!.length > 0) return "pool";
    if (typeof cfg?.poolCount === "number") return "pool";
  }

  if (product.virtualType === "account") {
    if (Array.isArray(cfg?.credentialPool) && cfg!.credentialPool!.length > 0) return "pool";
    if (typeof cfg?.poolCount === "number") return "pool";
  }

  if (product.stock !== undefined && product.stock !== null) {
    return product.stock <= 0 ? "out_of_stock" : "quantity";
  }

  return "unlimited";
}

/**
 * Returns whether a physical/quantity-mode product uses per-variant stock numbers.
 */
export function hasPerVariantStock(product?: StockableProduct | null): boolean {
  if (!product?.variants || product.variants.length === 0) return false;
  return product.variants.some((v) => v.stock !== undefined && v.stock !== null);
}

/**
 * Returns available stock for a specific variant (or the whole product when variantName is omitted):
 * - `null` means Unlimited stock
 * - `0` means Out of Stock
 * - `> 0` means exact available units
 */
export function getAvailableStock(
  product?: StockableProduct | null,
  variantName?: string | null
): number | null {
  if (!product) return 0;

  const isVirt = product.productKind === "virtual";

  if (isVirt) {
    const mode = resolveVirtualStockMode(product);
    if (mode === "out_of_stock") return 0;
    if (mode === "unlimited") return null;

    if (mode === "pool") {
      const cfg = product.virtualConfig || {};

      // Server/Admin view where actual arrays are present
      if (product.virtualType === "license" && Array.isArray(cfg.licensePool)) {
        const valid = cfg.licensePool.filter((k) => k?.key?.trim());
        if (variantName) {
          const tagged = valid.filter(
            (k) => k.variantName && k.variantName.trim().toLowerCase() === variantName.trim().toLowerCase()
          );
          const untagged = valid.filter((k) => !k.variantName);
          // If variant-specific keys exist or other variants have tagged keys, respect tagging + shared untagged
          const anyTagged = valid.some((k) => Boolean(k.variantName));
          return anyTagged ? tagged.length + untagged.length : valid.length;
        }
        return valid.length;
      }

      if (product.virtualType === "account" && Array.isArray(cfg.credentialPool)) {
        const valid = cfg.credentialPool.filter((c) => c?.email?.trim() && c?.password?.trim());
        if (variantName) {
          const tagged = valid.filter(
            (c) => c.variantName && c.variantName.trim().toLowerCase() === variantName.trim().toLowerCase()
          );
          const untagged = valid.filter((c) => !c.variantName);
          const anyTagged = valid.some((c) => Boolean(c.variantName));
          return anyTagged ? tagged.length + untagged.length : valid.length;
        }
        return valid.length;
      }

      // Sanitized public view using poolCount / variantPoolCounts
      if (variantName && cfg.variantPoolCounts && variantName in cfg.variantPoolCounts) {
        return Math.max(0, Number(cfg.variantPoolCounts[variantName]) || 0);
      }
      if (typeof cfg.poolCount === "number") {
        return Math.max(0, cfg.poolCount);
      }
      return 0;
    }
    // mode === "quantity" falls through to standard variant / product numeric stock logic below
  }

  // Quantity / Physical stock logic
  if (product.variants && product.variants.length > 0 && hasPerVariantStock(product)) {
    if (variantName) {
      const matched = product.variants.find(
        (v) => v.name.trim().toLowerCase() === variantName.trim().toLowerCase()
      );
      if (!matched) return 0;
      if (matched.stock === undefined || matched.stock === null) return null;
      return Math.max(0, Number(matched.stock) || 0);
    }

    // Aggregate across all variants: if any variant has unlimited stock, total is unlimited
    let sum = 0;
    for (const v of product.variants) {
      if (v.stock === undefined || v.stock === null) return null;
      sum += Math.max(0, Number(v.stock) || 0);
    }
    return sum;
  }

  if (product.stock === undefined || product.stock === null) {
    return null;
  }
  return Math.max(0, Number(product.stock) || 0);
}

export function isProductOutOfStock(
  product?: StockableProduct | null,
  variantName?: string | null
): boolean {
  const avail = getAvailableStock(product, variantName);
  return avail !== null && avail <= 0;
}

export interface StockSummary {
  status: "in_stock" | "low_stock" | "out_of_stock" | "unlimited";
  count: number | null;
  label: string;
}

export function getProductStockSummary(product: StockableProduct): StockSummary {
  const avail = getAvailableStock(product);
  if (avail === null) {
    return { status: "unlimited", count: null, label: "Unlimited" };
  }
  if (avail <= 0) {
    return { status: "out_of_stock", count: 0, label: "Stock Out" };
  }
  const suffix =
    product.productKind === "virtual" && resolveVirtualStockMode(product) === "pool"
      ? product.virtualType === "license"
        ? avail === 1
          ? "key"
          : "keys"
        : avail === 1
        ? "account"
        : "accounts"
      : "in stock";

  if (avail <= 5) {
    return { status: "low_stock", count: avail, label: `${avail} ${suffix}` };
  }
  return { status: "in_stock", count: avail, label: `${avail} ${suffix}` };
}

/**
 * Strips raw license keys and account passwords from public product payloads
 * while preserving exact stock availability counts for the storefront UI.
 */
export function sanitizePublicProduct<T extends Record<string, any>>(product: T): T {
  if (!product || typeof product !== "object") return product;
  const cfg = product.virtualConfig;
  if (!cfg || typeof cfg !== "object") return product;

  const hasLicenses = Array.isArray(cfg.licensePool);
  const hasCreds = Array.isArray(cfg.credentialPool);
  if (!hasLicenses && !hasCreds) return product;

  const mode = resolveVirtualStockMode(product as unknown as StockableProduct);
  let poolCount: number | undefined = cfg.poolCount;
  let variantPoolCounts: Record<string, number> | undefined = cfg.variantPoolCounts;

  if (mode === "pool") {
    poolCount = getAvailableStock(product as unknown as StockableProduct) ?? 0;
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      variantPoolCounts = {};
      for (const v of product.variants) {
        if (v?.name) {
          variantPoolCounts[v.name] =
            getAvailableStock(product as unknown as StockableProduct, v.name) ?? 0;
        }
      }
    }
  }

  const { licensePool: _lp, credentialPool: _cp, ...safeCfg } = cfg;
  return {
    ...product,
    virtualConfig: {
      ...safeCfg,
      ...(poolCount !== undefined ? { poolCount } : {}),
      ...(variantPoolCounts ? { variantPoolCounts } : {}),
    },
  };
}
