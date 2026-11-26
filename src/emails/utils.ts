import { getAppUrl } from "@/lib/app-url";

/**
 * Canonical store URL used for links inside transactional emails.
 * Uses the shared resolver so emails never contain localhost links.
 */
export function getShopUrl() {
  return getAppUrl();
}
