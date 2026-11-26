/**
 * Central, production-safe URL resolution.
 *
 * Why this exists:
 * Auth links (password reset / email verification), SEO metadata, sitemap,
 * robots and server-side "fetch myself" calls all need the canonical public
 * URL of the store. Previously each place used its own
 * `process.env.NEXT_PUBLIC_SHOP_URL || "http://localhost:3000"` fallback,
 * which meant a misconfigured (or missing) env var on Vercel produced emails
 * containing `http://localhost:3000/reset-password?...` — a dead link.
 *
 * This helper:
 *  1. Honours explicit configuration first.
 *  2. Rejects localhost values when running in production / on Vercel.
 *  3. Falls back to Vercel's runtime host values.
 *  4. Falls back to the project's known production domain as a last resort.
 */

const PRODUCTION_DOMAIN = "https://afratechpoint.shop";

function isProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function normalize(value: string | undefined | null): string | null {
  if (!value) return null;

  let url = value.trim().replace(/\/+$/, "");
  if (!url) return null;

  // Vercel exposes bare hostnames for VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL.
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

    // Never emit a localhost URL from a deployed app — that's how broken
    // password-reset links are born.
    if (isProductionRuntime() && isLocalHost(parsed.hostname)) return null;

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Returns the canonical store URL with no trailing slash.
 * e.g. https://afratechpoint.shop
 */
export function getAppUrl(): string {
  const candidates = [
    // Server-only overrides (no rebuild required on Vercel).
    process.env.SITE_URL,
    process.env.SHOP_URL,
    // NEXT_PUBLIC_* values are inlined at build time, so they must be set
    // before deploying. They still take precedence when valid.
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_SHOP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    // Runtime values provided by Vercel.
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    const resolved = normalize(candidate);
    if (resolved) return resolved;
  }

  return PRODUCTION_DOMAIN;
}

/**
 * Builds an absolute URL for a site path.
 * e.g. buildAppUrl("/reset-password?oobCode=abc")
 */
export function buildAppUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${getAppUrl()}${suffix}`;
}
