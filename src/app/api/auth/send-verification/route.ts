import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { EmailVerificationEmail } from "@/emails/renderers/index";
import { buildAppUrl } from "@/lib/app-url";

export async function POST(req: Request) {
  try {
    const { email, displayName } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // 1. Generate an email verification link from Firebase Admin 
    // This creates an OOB code for email verification
    const firebaseLink = await adminAuth.generateEmailVerificationLink(email);

    // 2. Extract the 'oobCode'
    const url = new URL(firebaseLink);
    const oobCode = url.searchParams.get("oobCode");

    // 3. Build our branded URL on the canonical public domain.
    // getAppUrl() never emits localhost from a deployed app.
    if (!oobCode) {
      throw new Error("Firebase did not return a verification code.");
    }
    const verificationLink = buildAppUrl(
      `/verify-email?oobCode=${encodeURIComponent(oobCode)}`
    );

    // 4. Send the branded email
    const result = await sendEmail({
      to: email,
      subject: "Activate your Afra Tech Point account",
      template: EmailVerificationEmail,
      props: { 
        customerName: displayName || "Customer", 
        verificationLink 
      }
    });

    if (result.success) {
      return NextResponse.json({ success: true, message: "Verification link sent!" });
    } else {
      return NextResponse.json({ error: "Failed to send verification email" }, { status: 500 });
    }
  } catch (err: any) {
    console.error("Verification Email API Error:", err);
    return NextResponse.json({ error: err.message || "Failed to process request" }, { status: 500 });
  }
}
