import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import { sanitizeHeaderValue } from "@/lib/security/validation";

interface SendEmailParams {
  to: string | string[];
  subject: string;
  template: (props: any) => React.ReactElement;
  props?: any;
  from?: string;
}

/**
 * Sends responsive HTML emails over SMTP with strict TLS certificate validation,
 * header-injection sanitization, and local file/URL access disabled.
 */
export async function sendEmail({
  to,
  subject,
  template,
  props,
  from = process.env.SMTP_FROM || `"Afra Tech Point" <${process.env.SMTP_USER}>`,
}: SendEmailParams) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Email] Missing SMTP configuration (SMTP_HOST/SMTP_USER/SMTP_PASS).");
    return { success: false, error: "Email service unavailable" };
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const isPort465 = port === 465;
  const secure =
    process.env.SMTP_SECURE === "true" ||
    (process.env.SMTP_SECURE === undefined && isPort465);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: {
      // Enforce valid TLS certificates against MITM credential interception
      rejectUnauthorized: process.env.SMTP_ALLOW_INSECURE_TLS !== "true",
      servername: process.env.SMTP_HOST.trim(),
    },
  });

  try {
    const html = await render(template(props || {}));
    const safeRecipients = (Array.isArray(to) ? to : [to])
      .map((addr) => sanitizeHeaderValue(addr, 254))
      .filter(Boolean);

    if (safeRecipients.length === 0) {
      return { success: false, error: "Invalid recipient address" };
    }

    const info = await transporter.sendMail({
      from: sanitizeHeaderValue(from, 254),
      to: safeRecipients.join(", "),
      subject: sanitizeHeaderValue(subject, 200),
      html,
      disableFileAccess: true,
      disableUrlAccess: true,
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    // Log error code only — never log raw SMTP transcripts or credentials
    console.error("[SMTP] Delivery error:", error?.code || "SEND_FAILED");
    throw new Error("Email delivery failed");
  }
}
