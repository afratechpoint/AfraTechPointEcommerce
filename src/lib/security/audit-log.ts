import { adminDb } from "@/lib/firebase/admin";
import admin from "firebase-admin";

export type SecurityEventSeverity = "info" | "warn" | "high" | "critical";

export interface SecurityAuditEvent {
  action: string;
  severity?: SecurityEventSeverity;
  actorUid?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  outcome: "allowed" | "denied" | "error";
  reason?: string;
  metadata?: Record<string, unknown>;
}

const REDACTED_KEYS = new Set([
  "password",
  "pass",
  "otp",
  "token",
  "idtoken",
  "customtoken",
  "authorization",
  "cookie",
  "privatekey",
  "secret",
  "secretkey",
  "apikey",
  "credentialpool",
  "licensepool",
  "deliveries",
]);

function scrubMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[Truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => scrubMetadata(v, depth + 1));
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k.toLowerCase().replace(/[_-]/g, ""))) {
      clean[k] = "[REDACTED]";
    } else {
      clean[k] = scrubMetadata(v, depth + 1);
    }
  }
  return clean;
}

export function getClientIp(request?: Request | { headers?: Headers } | null): string {
  if (!request?.headers) return "unknown";
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}

/**
 * Writes a structured, secret-scrubbed security audit record to Firestore
 * (`security_audit_logs`, write-only via Admin SDK) and structured server logs.
 * Non-blocking: audit persistence errors never crash legitimate user requests.
 */
export async function logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  const safeMeta = event.metadata ? (scrubMetadata(event.metadata) as Record<string, unknown>) : undefined;
  const severity = event.severity || (event.outcome === "denied" ? "warn" : "info");

  const record = {
    action: event.action,
    severity,
    actorUid: event.actorUid || null,
    actorEmail: event.actorEmail || null,
    actorRole: event.actorRole || null,
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    ip: event.ip || "unknown",
    outcome: event.outcome,
    reason: event.reason ? String(event.reason).slice(0, 300) : null,
    ...(safeMeta ? { metadata: safeMeta } : {}),
    timestampIso: new Date().toISOString(),
  };

  if (severity === "high" || severity === "critical" || event.outcome === "denied") {
    console.warn("[SECURITY_AUDIT]", JSON.stringify(record));
  }

  if (process.env.NEXT_PUBLIC_USE_FIREBASE === "true" && typeof adminDb?.collection === "function") {
    try {
      const col = adminDb.collection("security_audit_logs");
      if (typeof col.add === "function") {
        await col.add({
          ...record,
          createdAt: admin.firestore?.FieldValue?.serverTimestamp
            ? admin.firestore.FieldValue.serverTimestamp()
            : new Date(),
        });
      }
    } catch {
      // Never fail primary request if audit write fails
    }
  }
}
