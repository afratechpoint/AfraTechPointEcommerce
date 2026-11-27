import crypto from "crypto";
import { adminDb } from "@/lib/firebase/admin";

export interface RateLimitOptions {
  /** Logical namespace, e.g. "otp_send", "order_create", "contact" */
  bucket: string;
  /** Unique client key (IP address, normalized email, or UID) */
  identifier: string;
  /** Maximum allowed requests within windowMs */
  limit: number;
  /** Sliding/fixed window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface MemoryRateRecord {
  count: number;
  resetAt: number;
}

const gRate = globalThis as unknown as { __afraRateLimitMap?: Map<string, MemoryRateRecord> };
if (!gRate.__afraRateLimitMap) {
  gRate.__afraRateLimitMap = new Map<string, MemoryRateRecord>();
}
const memoryStore = gRate.__afraRateLimitMap;

function checkMemoryRateLimit(docId: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (memoryStore.size > 5000) {
    Array.from(memoryStore.entries()).forEach(([k, v]) => {
      if (now >= v.resetAt) memoryStore.delete(k);
    });
  }

  const existing = memoryStore.get(docId);
  if (!existing || now >= existing.resetAt) {
    memoryStore.set(docId, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Distributed rate limiter backed by Firestore transactions (`rate_limits` collection)
 * so limits hold across concurrent Vercel serverless instances, with automatic
 * in-memory fallback when running offline or in local unit tests.
 */
export async function checkRateLimit({
  bucket,
  identifier,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> {
  const cleanId = (identifier || "unknown").trim().toLowerCase();
  const keyHash = crypto
    .createHash("sha256")
    .update(`${bucket}:${cleanId}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  const docId = `${bucket}_${keyHash}`;

  const useFirestore =
    process.env.NEXT_PUBLIC_USE_FIREBASE === "true" &&
    typeof adminDb?.runTransaction === "function";

  if (!useFirestore) {
    return checkMemoryRateLimit(docId, limit, windowMs);
  }

  try {
    const now = Date.now();
    const ref = adminDb.collection("rate_limits").doc(docId);

    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;

      if (!data || typeof data.resetAt !== "number" || now >= data.resetAt) {
        const resetAt = now + windowMs;
        tx.set(ref, {
          bucket,
          count: 1,
          resetAt,
          updatedAt: now,
        });
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          retryAfterSeconds: Math.ceil(windowMs / 1000),
        };
      }

      if (data.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((data.resetAt - now) / 1000)),
        };
      }

      const nextCount = Number(data.count || 0) + 1;
      tx.update(ref, { count: nextCount, updatedAt: now });
      return {
        allowed: true,
        remaining: Math.max(0, limit - nextCount),
        retryAfterSeconds: Math.max(1, Math.ceil((data.resetAt - now) / 1000)),
      };
    });
  } catch {
    return checkMemoryRateLimit(docId, limit, windowMs);
  }
}

export function resetMemoryRateLimitsForTesting() {
  memoryStore.clear();
}
