import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/firebase/admin";
import { verifyAdmin, verifyUser } from "@/lib/auth-server";
import { sendEmail } from "@/lib/email/sendEmail";
import { EmailVerificationEmail } from "@/emails/renderers/index";
import { buildAppUrl } from "@/lib/app-url";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const sendVerificationSchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    // Require authenticated user (requesting verification for their own email) or admin
    const adminCaller = await verifyAdmin(req);
    const userCaller = !adminCaller ? await verifyUser(req) : null;

    if (!adminCaller && !userCaller) {
      await logSecurityEvent({
        action: "auth.send_verification",
        severity: "warn",
        ip,
        outcome: "denied",
        reason: "Unauthenticated verification email request rejected",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkRateLimit({
      bucket: "send_verification",
      identifier: (adminCaller || userCaller)!.uid,
      limit: 3,
      windowMs: 15 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many verification emails requested. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const rawBody = await req.json();
    const parsed = sendVerificationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const cleanEmail = parsed.data.email.toLowerCase();

    if (!adminCaller && userCaller?.email?.trim().toLowerCase() !== cleanEmail) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const firebaseLink = await adminAuth.generateEmailVerificationLink(cleanEmail);
    const url = new URL(firebaseLink);
    const oobCode = url.searchParams.get("oobCode");

    if (!oobCode) {
      throw new Error("Missing oobCode");
    }

    const verificationLink = buildAppUrl(
      `/verify-email?oobCode=${encodeURIComponent(oobCode)}`
    );

    const result = await sendEmail({
      to: cleanEmail,
      subject: "Activate your Afra Tech Point account",
      template: EmailVerificationEmail,
      props: {
        customerName: parsed.data.displayName || "Customer",
        verificationLink,
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to send verification email." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Verification link sent!" });
  } catch (err: any) {
    console.error("[Send Verification API] Error:", err?.code || err?.message);
    return NextResponse.json(
      { error: "Failed to process verification request." },
      { status: 500 }
    );
  }
}
