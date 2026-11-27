import { adminAuth, adminDb } from "./firebase/admin";
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import type { AppRole } from "./security/validation";

export interface VerifiedCaller {
  uid: string;
  email?: string;
  email_verified?: boolean;
  role?: string;
  [key: string]: any;
}

type TokenVerifierFn = (idToken: string, checkRevoked?: boolean) => Promise<VerifiedCaller | null>;

let testVerifierOverride: TokenVerifierFn | null = null;

/**
 * Allows automated security regression tests (`AFRA_SECURITY_TEST_MODE=1` in non-production)
 * to exercise real route handlers and server actions with deterministic test identities.
 */
export function setTokenVerifierForTesting(fn: TokenVerifierFn | null) {
  if (process.env.NODE_ENV === "production" || process.env.AFRA_SECURITY_TEST_MODE !== "1") {
    throw new Error("Test token verifier is disabled outside security test mode.");
  }
  testVerifierOverride = fn;
}

export function getAdminEmails(): string[] {
  const raw = [process.env.ADMIN_EMAIL, process.env.NEXT_PUBLIC_ADMIN_EMAILS]
    .filter(Boolean)
    .join(",");
  return Array.from(
    new Set(
      raw
        .toLowerCase()
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.includes("@"))
    )
  );
}

export function getPrimarySuperAdminEmail(): string {
  const primary = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (primary && primary.includes("@")) return primary;
  return getAdminEmails()[0] || "";
}

export function isConfiguredAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return getAdminEmails().includes(normalized);
}

export async function verifyIdTokenString(
  idToken: string,
  checkRevoked = false
): Promise<VerifiedCaller | null> {
  if (!idToken || typeof idToken !== "string" || idToken.length > 8192) {
    return null;
  }

  if (
    testVerifierOverride &&
    process.env.NODE_ENV !== "production" &&
    process.env.AFRA_SECURITY_TEST_MODE === "1"
  ) {
    return testVerifierOverride(idToken, checkRevoked);
  }

  if (!adminAuth || typeof adminAuth.verifyIdToken !== "function") {
    return null;
  }

  try {
    return await adminAuth.verifyIdToken(idToken, checkRevoked);
  } catch {
    return null;
  }
}

/**
 * Resolves the effective server-trusted RBAC role for a verified Firebase token.
 * Never trusts client-supplied role parameters.
 */
export async function resolveUserRole(decodedToken: VerifiedCaller | null): Promise<AppRole> {
  if (!decodedToken?.uid) return "customer";

  // 1. Configured super-admin email (requires verified email unless custom token login verified OTP)
  if (
    decodedToken.email &&
    decodedToken.email_verified !== false &&
    isConfiguredAdminEmail(decodedToken.email)
  ) {
    return "admin";
  }

  // 2. Trusted Firebase custom claim set by super-admin
  const claimRole = decodedToken.role;
  if (claimRole === "admin" || claimRole === "shop_manager" || claimRole === "order_manager") {
    return claimRole;
  }

  // 3. Server-controlled `users/{uid}.role` in Firestore (protected against customer writes)
  try {
    const snap = await adminDb.collection("users").doc(decodedToken.uid).get();
    const dbRole = snap?.data()?.role;
    if (dbRole === "admin" || dbRole === "shop_manager" || dbRole === "order_manager") {
      return dbRole;
    }
  } catch {
    // Fall back to least-privilege customer role
  }

  return "customer";
}

export async function hasAdminAccess(decodedToken: VerifiedCaller | null): Promise<boolean> {
  const role = await resolveUserRole(decodedToken);
  return role === "admin";
}

function extractBearerToken(request: Request | NextRequest): string | null {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Verifies any authenticated user from the `Authorization: Bearer <idToken>` header.
 */
export async function verifyUser(
  request: Request | NextRequest,
  options?: { checkRevoked?: boolean }
): Promise<VerifiedCaller | null> {
  const idToken = extractBearerToken(request);
  if (!idToken) return null;
  return verifyIdTokenString(idToken, Boolean(options?.checkRevoked));
}

/**
 * Verifies full `admin` privileges.
 */
export async function verifyAdmin(
  request: Request | NextRequest,
  options?: { checkRevoked?: boolean }
): Promise<(VerifiedCaller & { resolvedRole: "admin" }) | null> {
  const decoded = await verifyUser(request, options);
  if (!decoded) return null;
  const role = await resolveUserRole(decoded);
  if (role !== "admin") return null;
  return { ...decoded, resolvedRole: "admin" };
}

/**
 * Verifies catalog/inventory management privileges (`admin` or `shop_manager`).
 */
export async function verifyCatalogStaff(
  request: Request | NextRequest,
  options?: { checkRevoked?: boolean }
): Promise<(VerifiedCaller & { resolvedRole: "admin" | "shop_manager" }) | null> {
  const decoded = await verifyUser(request, options);
  if (!decoded) return null;
  const role = await resolveUserRole(decoded);
  if (role !== "admin" && role !== "shop_manager") return null;
  return { ...decoded, resolvedRole: role };
}

/**
 * Verifies order/fulfillment/notification staff privileges (`admin`, `shop_manager`, or `order_manager`).
 */
export async function verifyOrderStaff(
  request: Request | NextRequest,
  options?: { checkRevoked?: boolean }
): Promise<(VerifiedCaller & { resolvedRole: "admin" | "shop_manager" | "order_manager" }) | null> {
  const decoded = await verifyUser(request, options);
  if (!decoded) return null;
  const role = await resolveUserRole(decoded);
  if (role !== "admin" && role !== "shop_manager" && role !== "order_manager") return null;
  return { ...decoded, resolvedRole: role };
}

/**
 * Verifies an explicit ID token string for privileged Server Actions.
 */
export async function verifyAdminToken(
  idToken: string,
  options?: { checkRevoked?: boolean }
): Promise<(VerifiedCaller & { resolvedRole: "admin" }) | null> {
  const decoded = await verifyIdTokenString(idToken, options?.checkRevoked ?? true);
  if (!decoded) return null;
  const role = await resolveUserRole(decoded);
  if (role !== "admin") return null;
  return { ...decoded, resolvedRole: "admin" };
}

/**
 * Server Action admin verifier. Accepts an explicit `idToken` argument or reads the
 * `Authorization: Bearer <token>` header from the incoming Server Action request.
 * Does not read unverified non-HttpOnly client cookies.
 */
export async function verifyAdminAction(explicitToken?: string): Promise<VerifiedCaller | null> {
  try {
    if (explicitToken) {
      return await verifyAdminToken(explicitToken, { checkRevoked: true });
    }

    const h = await headers();
    const authHeader = h.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const idToken = authHeader.slice("Bearer ".length).trim();
      const decoded = await verifyIdTokenString(idToken, true);
      if (decoded && (await hasAdminAccess(decoded))) {
        return decoded;
      }
    }

    return null;
  } catch {
    return null;
  }
}
