import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { PasswordResetEmail } from "@/emails/renderers/index";
import { buildAppUrl } from "@/lib/app-url";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const resetSchema = z.object({
  email: z.string().trim().email("A valid email address is required.").max(200),
});

const GENERIC_SUCCESS_MSG =
  "If an account exists for this email, a password reset link has been sent.";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    const ipLimit = await checkRateLimit({
      bucket: "pwd_reset_ip",
      identifier: ip,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many password reset requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const rawBody = await req.json();
    const parsed = resetSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Email is required" },
        { status: 400 }
      );
    }

    const cleanEmail = parsed.data.email.toLowerCase();

    const emailLimit = await checkRateLimit({
      bucket: "pwd_reset_email",
      identifier: cleanEmail,
      limit: 3,
      windowMs: 15 * 60 * 1000,
    });
    if (!emailLimit.allowed) {
      // Return generic success on per-email throttle to prevent account enumeration
      return NextResponse.json({ success: true, message: GENERIC_SUCCESS_MSG });
    }

    try {
      const userRecord = await adminAuth.getUserByEmail(cleanEmail);
      if (userRecord.disabled) {
        return NextResponse.json({ success: true, message: GENERIC_SUCCESS_MSG });
      }

      const firebaseLink = await adminAuth.generatePasswordResetLink(cleanEmail);
      const url = new URL(firebaseLink);
      const oobCode = url.searchParams.get("oobCode");

      if (!oobCode) {
        throw new Error("Missing oobCode");
      }

      const resetLink = buildAppUrl(`/reset-password?oobCode=${encodeURIComponent(oobCode)}`);

      await sendEmail({
        to: cleanEmail,
        subject: "Reset your Afra Tech Point password",
        template: PasswordResetEmail,
        props: {
          customerName: userRecord.displayName || "Customer",
          resetLink,
        },
      });

      await logSecurityEvent({
        action: "auth.password_reset_requested",
        severity: "info",
        actorEmail: cleanEmail,
        ip,
        outcome: "allowed",
      });

      return NextResponse.json({ success: true, message: GENERIC_SUCCESS_MSG });
    } catch (authError: any) {
      if (authError?.code === "auth/user-not-found") {
        return NextResponse.json({ success: true, message: GENERIC_SUCCESS_MSG });
      }
      throw authError;
    }
  } catch (err: any) {
    console.error("[Reset Password API] Error:", err?.code || err?.message);
    return NextResponse.json(
      { error: "Unable to process password reset right now. Please try again later." },
      { status: 500 }
    );
  }
}
