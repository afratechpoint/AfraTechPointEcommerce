"use server";

import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  getPrimarySuperAdminEmail,
  isConfiguredAdminEmail,
  verifyAdminToken,
  verifyIdTokenString,
} from "@/lib/auth-server";
import { ALLOWED_ROLES } from "@/lib/security/validation";
import { logSecurityEvent } from "@/lib/security/audit-log";

const uidSchema = z.string().trim().min(1).max(128);
const roleSchema = z.enum(ALLOWED_ROLES);

export async function getUsers(token: string) {
  const caller = await verifyAdminToken(token, { checkRevoked: true });
  if (!caller) {
    await logSecurityEvent({
      action: "admin.customers.list",
      severity: "warn",
      outcome: "denied",
      reason: "Unauthorized attempt to list customer accounts",
    });
    throw new Error("Unauthorized");
  }

  const listResult = await adminAuth.listUsers(1000);
  const snapshot = await adminDb.collection("users").get();
  const firestoreMap: Record<string, any> = {};
  snapshot.forEach((doc: any) => {
    firestoreMap[doc.id] = doc.data();
  });

  return listResult.users
    .map((authUser: any) => {
      const fs = firestoreMap[authUser.uid] || {};
      const email = authUser.email || fs.email || "";
      const effectiveRole = isConfiguredAdminEmail(email)
        ? "admin"
        : authUser.customClaims?.role || fs.role || "customer";

      return {
        uid: authUser.uid,
        email,
        displayName: authUser.displayName || fs.displayName || "",
        role: effectiveRole,
        createdAt: authUser.metadata.creationTime || new Date().toISOString(),
      };
    })
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getSuperAdminEmail(token: string): Promise<string> {
  const caller = await verifyAdminToken(token, { checkRevoked: true });
  if (!caller) {
    throw new Error("Unauthorized");
  }
  return getPrimarySuperAdminEmail();
}

export async function updateUserRole(targetUid: string, newRole: string, token: string) {
  const parsedUid = uidSchema.safeParse(targetUid);
  const parsedRole = roleSchema.safeParse(newRole);
  if (!parsedUid.success || !parsedRole.success) {
    throw new Error("Invalid user ID or role.");
  }

  const callerDecoded = await verifyIdTokenString(token, true);
  if (!callerDecoded?.uid || !callerDecoded?.email || callerDecoded.email_verified === false) {
    await logSecurityEvent({
      action: "admin.customers.update_role",
      severity: "high",
      outcome: "denied",
      targetType: "user",
      targetId: parsedUid.data,
      reason: "Unauthenticated or unverified caller",
    });
    throw new Error("Unauthorized");
  }

  const callerEmail = callerDecoded.email.trim().toLowerCase();
  const superAdminEmail = getPrimarySuperAdminEmail();

  if (!superAdminEmail || callerEmail !== superAdminEmail) {
    await logSecurityEvent({
      action: "admin.customers.update_role",
      severity: "critical",
      actorUid: callerDecoded.uid,
      actorEmail: callerEmail,
      targetType: "user",
      targetId: parsedUid.data,
      outcome: "denied",
      reason: "Non-super-admin attempted role modification",
      metadata: { requestedRole: parsedRole.data },
    });
    throw new Error("Only the permanent super-admin can change user roles.");
  }

  if (callerDecoded.uid === parsedUid.data) {
    throw new Error("You cannot change your own role.");
  }

  const targetUser = await adminAuth.getUser(parsedUid.data);
  if (targetUser.email && targetUser.email.trim().toLowerCase() === superAdminEmail) {
    throw new Error("The permanent super-admin's role cannot be changed.");
  }

  await adminAuth.setCustomUserClaims(parsedUid.data, { role: parsedRole.data });
  await adminDb
    .collection("users")
    .doc(parsedUid.data)
    .set({ role: parsedRole.data }, { merge: true });

  // Force token refresh on target user's next privileged action so role demotions take immediate effect
  await adminAuth.revokeRefreshTokens(parsedUid.data).catch(() => {});

  await logSecurityEvent({
    action: "admin.customers.update_role",
    severity: "high",
    actorUid: callerDecoded.uid,
    actorEmail: callerEmail,
    actorRole: "admin",
    targetType: "user",
    targetId: parsedUid.data,
    outcome: "allowed",
    metadata: { newRole: parsedRole.data, targetEmail: targetUser.email || "" },
  });

  return { success: true };
}

export async function deleteUserAccount(targetUid: string, token: string) {
  const parsedUid = uidSchema.safeParse(targetUid);
  if (!parsedUid.success) {
    throw new Error("Invalid user ID.");
  }

  const caller = await verifyAdminToken(token, { checkRevoked: true });
  if (!caller) {
    await logSecurityEvent({
      action: "admin.customers.delete_user",
      severity: "high",
      targetType: "user",
      targetId: parsedUid.data,
      outcome: "denied",
      reason: "Unauthorized user deletion attempt",
    });
    throw new Error("Unauthorized");
  }

  if (caller.uid === parsedUid.data) {
    throw new Error("You cannot delete your own account from the admin panel.");
  }

  const targetUser = await adminAuth.getUser(parsedUid.data);
  const superAdminEmail = getPrimarySuperAdminEmail();
  if (
    targetUser.email &&
    (isConfiguredAdminEmail(targetUser.email) ||
      (superAdminEmail && targetUser.email.trim().toLowerCase() === superAdminEmail))
  ) {
    throw new Error("Protected administrator accounts cannot be deleted.");
  }

  await adminAuth.revokeRefreshTokens(parsedUid.data).catch(() => {});
  await adminAuth.deleteUser(parsedUid.data);
  await adminDb.collection("users").doc(parsedUid.data).delete();

  await logSecurityEvent({
    action: "admin.customers.delete_user",
    severity: "high",
    actorUid: caller.uid,
    actorEmail: caller.email || null,
    actorRole: "admin",
    targetType: "user",
    targetId: parsedUid.data,
    outcome: "allowed",
    metadata: { deletedEmail: targetUser.email || "" },
  });

  return { success: true };
}
