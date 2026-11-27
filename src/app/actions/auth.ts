"use server";

import { verifyIdTokenString } from "@/lib/auth-server";
import { syncVerifiedUserRecord } from "@/lib/auth-sync";
import { logSecurityEvent } from "@/lib/security/audit-log";

/**
 * Authenticated Server Action to sync the currently signed-in user's profile.
 * Derives `uid` and `email` strictly from the verified Firebase ID token —
 * never trusts client-supplied `uid`, `email`, or `role`.
 */
export async function syncUserToFirestore(
  idToken: string,
  displayName?: string,
  photoURL?: string
) {
  try {
    const decoded = await verifyIdTokenString(idToken);
    if (!decoded?.uid) {
      await logSecurityEvent({
        action: "auth.sync_user",
        severity: "warn",
        outcome: "denied",
        reason: "Missing or invalid Firebase ID token on syncUserToFirestore",
      });
      return { success: false, error: "Unauthorized" };
    }

    const userData = await syncVerifiedUserRecord(
      decoded.uid,
      decoded.email || "",
      displayName || decoded.name || "",
      photoURL || decoded.picture || ""
    );

    return {
      success: true,
      userData,
    };
  } catch (error: any) {
    console.error("[syncUserToFirestore] Failed:", error?.message);
    return { success: false, error: "Failed to sync account." };
  }
}
