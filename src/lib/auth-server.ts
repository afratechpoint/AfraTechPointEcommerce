import { adminAuth, adminDb } from "./firebase/admin";
import { NextRequest } from "next/server";
import { headers } from "next/headers";

function getAdminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
  return raw
    .toLowerCase()
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);
}

/**
 * Single source of truth for "is this user an admin?".
 * Must stay in sync with AuthContext on the client, which grants the admin UI
 * based on the Firestore `role` OR the configured admin email. Otherwise a
 * valid admin can open the panel but gets 401 from every admin API.
 */
export async function hasAdminAccess(decodedToken: any): Promise<boolean> {
  if (!decodedToken?.email) return false;

  // 1. Super-admin email configured in env
  if (getAdminEmails().includes(decodedToken.email.toLowerCase())) return true;

  // 2. Custom claim set by the admin panel
  if (decodedToken.role === "admin") return true;

  // 3. Firestore role (the same check the client uses)
  try {
    const snap = await adminDb.collection("users").doc(decodedToken.uid).get();
    if (snap?.data()?.role === "admin") return true;
  } catch (err) {
    console.warn("[Auth] Firestore role check failed:", err);
  }

  return false;
}

/**
 * Verifies a Firebase ID token from the Authorization header and checks admin access.
 */
export async function verifyAdmin(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) return null;

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    if (!decodedToken) return null;

    return (await hasAdminAccess(decodedToken)) ? decodedToken : null;
  } catch (error) {
    console.error("[Auth] Token verification failed:", error);
    return null;
  }
}

/**
 * Generic user verification for non-admin protected routes.
 */
export async function verifyUser(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) return null;

    return await adminAuth.verifyIdToken(idToken);
  } catch (error) {
    return null;
  }
}

/**
 * Version for Server Actions. Reads from headers directly.
 */
export async function verifyAdminAction() {
  try {
    const h = await headers();

    // 1. Try Authorization header first (works if client sends it)
    const authHeader = h.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      if (await hasAdminAccess(decodedToken)) return decodedToken;
    }

    // 2. Fallback: Try cookie-based session
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("__session")?.value || cookieStore.get("session")?.value;
    if (sessionCookie) {
      const decodedToken = await adminAuth.verifyIdToken(sessionCookie);
      if (await hasAdminAccess(decodedToken)) return decodedToken;
    }

    // 3. Fallback: Check cookie header manually for Firebase token
    const cookieHeader = h.get("cookie") || "";
    const firebaseTokenMatch = cookieHeader.match(/firebaseIdToken=([^;]+)/);
    if (firebaseTokenMatch) {
      const decodedToken = await adminAuth.verifyIdToken(firebaseTokenMatch[1]);
      if (await hasAdminAccess(decodedToken)) return decodedToken;
    }

    return null;
  } catch (err) {
    console.error("[verifyAdminAction] Auth failed:", err);
    return null;
  }
}
