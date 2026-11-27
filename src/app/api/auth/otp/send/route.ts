import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { OtpEmail } from "@/emails/renderers/index";
import {
  encryptTransientSecret,
  generateSecureOtp,
  hashOtp,
} from "@/lib/security/crypto-helpers";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const sendOtpSchema = z.object({
  email: z.string().trim().email("A valid email is required").max(200),
  type: z.enum(["register", "login"]),
  name: z.string().trim().max(100).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    // 1. Per-IP rate limit (protects against credential stuffing & SMTP abuse)
    const ipLimit = await checkRateLimit({
      bucket: "otp_send_ip",
      identifier: ip,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification requests. Please wait a few minutes and try again." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const rawBody = await req.json();
    const parsed = sendOtpSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request data" },
        { status: 400 }
      );
    }

    const { type, name, password } = parsed.data;
    const cleanEmail = parsed.data.email.toLowerCase();

    // 2. Per-email rate limit
    const emailLimit = await checkRateLimit({
      bucket: "otp_send_email",
      identifier: cleanEmail,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many codes requested for this email. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
      );
    }

    // Enforce minimum cooldown between consecutive OTP dispatches to the same inbox
    const existingOtpSnap = await adminDb.collection("otps").doc(cleanEmail).get();
    if (existingOtpSnap.exists) {
      const prev = existingOtpSnap.data();
      const createdMs =
        typeof prev?.createdAtMs === "number"
          ? prev.createdAtMs
          : prev?.createdAt?.toDate
          ? prev.createdAt.toDate().getTime()
          : 0;
      if (createdMs && Date.now() - createdMs < OTP_RESEND_COOLDOWN_MS) {
        return NextResponse.json(
          { error: "Please wait a moment before requesting another code." },
          { status: 429 }
        );
      }
    }

    let resolvedName = name || "Customer";
    let uid = "";

    // ── 3. REGISTRATION VALIDATION ──────────────────────────────────────────
    if (type === "register") {
      if (!name || !name.trim()) {
        return NextResponse.json({ error: "Name and password are required" }, { status: 400 });
      }

      try {
        const existingUser = await adminAuth.getUserByEmail(cleanEmail);
        if (existingUser) {
          return NextResponse.json(
            { error: "Unable to complete registration with this email. Try signing in instead." },
            { status: 400 }
          );
        }
      } catch (err: any) {
        if (err?.code !== "auth/user-not-found") {
          console.warn("[OTP] User lookup warning:", err?.code || "lookup_error");
        }
      }
      resolvedName = name.trim();
    }

    // ── 4. LOGIN CREDENTIAL VALIDATION ──────────────────────────────────────
    if (type === "login") {
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Authentication service unavailable." }, { status: 503 });
      }

      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            returnSecureToken: false,
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        await logSecurityEvent({
          action: "auth.login_password_check",
          severity: "warn",
          actorEmail: cleanEmail,
          ip,
          outcome: "denied",
          reason: "Invalid email or password during login OTP step",
        });
        return NextResponse.json({ error: "Incorrect email or password." }, { status: 400 });
      }

      uid = verifyData.localId;

      try {
        const userRec = await adminAuth.getUser(uid);
        if (userRec.disabled) {
          return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
        }
        if (userRec.displayName) resolvedName = userRec.displayName;
      } catch {}
    }

    // ── 5. GENERATE CSPRNG 6-DIGIT OTP & STORE HASHED + ENCRYPTED ───────────
    const otp = generateSecureOtp();
    const { hash: otpHash, salt: otpSalt } = hashOtp(otp);

    await adminDb
      .collection("otps")
      .doc(cleanEmail)
      .set({
        otpHash,
        otpSalt,
        type,
        email: cleanEmail,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        attempts: 0,
        createdAtMs: Date.now(),
        createdAt: new Date(),
        ...(type === "register"
          ? {
              registrationData: {
                name: resolvedName,
                encryptedPassword: encryptTransientSecret(password),
              },
            }
          : {}),
        ...(type === "login" ? { uid } : {}),
      });

    // ── 6. SEND BRANDED EMAIL (Do not place secret OTP digits in Subject header) ──
    const emailResult = await sendEmail({
      to: cleanEmail,
      subject:
        type === "register"
          ? "Verify Your Account — Afra Tech Point"
          : "Login Verification Code — Afra Tech Point",
      template: OtpEmail,
      props: {
        customerName: resolvedName,
        otp,
        actionType: type,
      },
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { error: "Failed to dispatch verification email. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${cleanEmail}.`,
    });
  } catch (err: any) {
    console.error("[OTP Send] Unexpected error:", err?.code || err?.message);
    return NextResponse.json({ error: "Failed to send verification code." }, { status: 500 });
  }
}
