import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { sendEmail } from "@/lib/email/sendEmail";
import { ContactAutoReply, ContactAdminNotification } from "@/emails/renderers/index";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sanitizeHeaderValue } from "@/lib/security/validation";
import { getClientIp } from "@/lib/security/audit-log";

const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address.").max(200),
    message: z
      .string()
      .trim()
      .min(10, "Message must be at least 10 characters.")
      .max(2000, "Message is too long."),
  })
  .strict();

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    const rl = await checkRateLimit({
      bucket: "contact_form",
      identifier: ip,
      limit: 3,
      windowMs: 15 * 60 * 1000,
    });

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait 15 minutes before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input." },
        { status: 400 }
      );
    }

    const name = sanitizeHeaderValue(parsed.data.name, 100);
    const email = parsed.data.email.toLowerCase();
    const { message } = parsed.data;

    const settings = await storage.getSettings();
    const adminEmail =
      settings?.adminEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    const logoUrl = settings?.logoUrl;
    const shopUrl = settings?.shopUrl;

    if (!adminEmail) {
      return NextResponse.json(
        { error: "Contact service is temporarily unavailable." },
        { status: 503 }
      );
    }

    const results = await Promise.allSettled([
      sendEmail({
        to: email,
        subject: "We've received your message! — Afra Tech Point",
        template: ContactAutoReply,
        props: { name, logoUrl, shopUrl },
      }),
      sendEmail({
        to: adminEmail,
        subject: `New Inquiry from ${name}`,
        template: ContactAdminNotification,
        props: { name, email, message, logoUrl, shopUrl },
      }),
    ]);

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length === results.length) {
      return NextResponse.json(
        { error: "Unable to send message right now. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Message received successfully.",
    });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
