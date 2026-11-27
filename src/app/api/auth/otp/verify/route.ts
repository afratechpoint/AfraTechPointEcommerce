import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { syncVerifiedUserRecord } from "@/lib/auth-sync";
import {
  decryptTransientSecret,
  verifyOtpHash,
} from "@/lib/security/crypto-helpers";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const verifyOtpSchema = z.object({
  email: z.string().trim().email().max(200),
  otp: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{6}$/.test(v), "Enter a valid 6-digit verification code."),
  type: z.enum(["register", "login"]),
});

const MAX_OTP_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    // 1. Per-IP brute-force protection
    const ipLimit = await checkRateLimit({
      bucket: "otp_verify_ip",
      identifier: ip,
      limit: 15,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const rawBody = await req.json();
    const parsed = verifyOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Email and 6-digit OTP code are required" },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.toLowerCase();
    const cleanOtp = parsed.data.otp;
    const { type } = parsed.data;

    const emailLimit = await checkRateLimit({
      bucket: "otp_verify_email",
      identifier: cleanEmail,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please request a new code later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
      );
    }

    const otpDocRef = adminDb.collection("otps").doc(cleanEmail);

    // 2. Atomic transactional verification (prevents concurrent race-condition brute force & replay)
    const txOutcome = await adminDb.runTransaction(async (tx: any) => {
      const otpDocSnap = await tx.get(otpDocRef);
      if (!otpDocSnap.exists) {
        return { ok: false as const, status: 400, error: "No active verification code found or it has expired. Please request a new one." };
      }

      const otpData = otpDocSnap.data() || {};

      if (Date.now() > Number(otpData.expiresAt || 0)) {
        tx.delete(otpDocRef);
        return { ok: false as const, status: 400, error: "This verification code has expired. Please request a new one." };
      }

      if (otpData.type !== type) {
        return { ok: false as const, status: 400, error: "Invalid verification action for this code." };
      }

      const currentAttempts = Number(otpData.attempts || 0);
      if (currentAttempts >= MAX_OTP_ATTEMPTS) {
        tx.delete(otpDocRef);
        return { ok: false as const, status: 400, error: "Too many failed attempts. Please request a new verification code." };
      }

      const isMatch = otpData.otpHash && otpData.otpSalt
        ? verifyOtpHash(cleanOtp, otpData.otpHash, otpData.otpSalt)
        : false;

      if (!isMatch) {
        const nextAttempts = currentAttempts + 1;
        if (nextAttempts >= MAX_OTP_ATTEMPTS) {
          tx.delete(otpDocRef);
        } else {
          tx.update(otpDocRef, { attempts: nextAttempts });
        }
        const remaining = Math.max(0, MAX_OTP_ATTEMPTS - nextAttempts);
        return {
          ok: false as const,
          status: 400,
          error:
            remaining > 0
              ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
              : "Too many failed attempts. Please request a new code.",
        };
      }

      // Valid match — atomically consume (delete) OTP inside the transaction so it can never be replayed
      tx.delete(otpDocRef);
      return { ok: true as const, otpData };
    });

    if (!txOutcome.ok) {
      await logSecurityEvent({
        action: "auth.otp_verify",
        severity: "warn",
        actorEmail: cleanEmail,
        ip,
        outcome: "denied",
        reason: txOutcome.error,
      });
      return NextResponse.json({ error: txOutcome.error }, { status: txOutcome.status });
    }

    const { otpData } = txOutcome;
    let customToken = "";

    if (type === "register") {
      const regData = otpData.registrationData;
      const rawPassword = regData?.encryptedPassword
        ? decryptTransientSecret(regData.encryptedPassword)
        : null;

      if (!regData || !rawPassword) {
        return NextResponse.json(
          { error: "Missing registration payload. Please register again." },
          { status: 400 }
        );
      }

      const userRecord = await adminAuth.createUser({
        email: cleanEmail,
        password: rawPassword,
        displayName: regData.name,
        emailVerified: true,
      });

      await syncVerifiedUserRecord(userRecord.uid, cleanEmail, regData.name, "");
      customToken = await adminAuth.createCustomToken(userRecord.uid);
    } else if (type === "login") {
      const targetUid = otpData.uid
        ? String(otpData.uid)
        : (await adminAuth.getUserByEmail(cleanEmail)).uid;
      const userRec = await adminAuth.getUser(targetUid);
      if (userRec.disabled) {
        return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
      }
      customToken = await adminAuth.createCustomToken(targetUid);
    }

    await logSecurityEvent({
      action: `auth.otp_verified_${type}`,
      severity: "info",
      actorEmail: cleanEmail,
      ip,
      outcome: "allowed",
    });

    return NextResponse.json({
      success: true,
      customToken,
      message:
        type === "register"
          ? "Registration verified successfully!"
          : "Login verified successfully!",
    });
  } catch (err: any) {
    console.error("[OTP Verify] Unexpected error:", err?.code || err?.message);
    return NextResponse.json({ error: "Failed to verify code." }, { status: 500 });
  }
}
