export const dynamic = "force-dynamic";
import { verifyAdmin } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { isSafeUrlOrRelativePath } from "@/lib/security/validation";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import { revalidatePath } from "next/cache";

const defaultSettings = {
  storeName: "Afra Tech Point",
  logoUrl: "/logo.png",
  contactEmail: "afratechpoint@gmail.com",
  contactPhone: "+880 1974-722102",
  contactAddress: "Dhaka, Bangladesh",
  shortDescription:
    "Your premium destination for the latest in cutting-edge electronics and smart home devices.",
  currencySymbol: "৳",
  themeId: "midnight",
  announcementText:
    "Welcome to Afra Tech Point! Experience premium tech and exceptional service. Shop now.",
  announcementActive: false,
  businessHours: "Daily: 10:00 AM - 10:00 PM",
  navLinks: [{ id: "1", label: "Home", href: "/" }],
  banners: [],
  categories: [],
  socialLinks: [],
  footerProducts: [],
  footerCompany: [],
};

const safeLinkSchema = z.object({
  id: z.string().trim().max(64),
  label: z.string().trim().max(80),
  href: z
    .string()
    .trim()
    .max(512)
    .refine((v) => !v || isSafeUrlOrRelativePath(v), "Unsafe link URL"),
});

const settingsUpdateSchema = z
  .object({
    storeName: z.string().trim().min(1).max(120).optional(),
    logoUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid logo URL")
      .optional(),
    signatureUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid signature URL")
      .optional(),
    signatureName: z.string().trim().max(100).optional(),
    contactEmail: z.string().trim().max(200).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    contactAddress: z.string().trim().max(300).optional(),
    shortDescription: z.string().trim().max(500).optional(),
    currencySymbol: z.string().trim().max(10).optional(),
    announcementText: z.string().trim().max(300).optional(),
    announcementActive: z.boolean().optional(),
    businessHours: z.string().trim().max(120).optional(),
    codEnabled: z.boolean().optional(),
    deliveryCharge: z.number().nonnegative().max(100_000).optional(),
    navLinks: z.array(safeLinkSchema).max(20).optional(),
    footerProducts: z.array(safeLinkSchema).max(30).optional(),
    footerCompany: z.array(safeLinkSchema).max(30).optional(),
    socialLinks: z
      .array(
        z.object({
          id: z.string().trim().max(64),
          platform: z.string().trim().max(50),
          url: z
            .string()
            .trim()
            .max(1024)
            .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid social URL"),
        })
      )
      .max(20)
      .optional(),
    paymentMethods: z
      .array(
        z.object({
          id: z.string().trim().max(64),
          name: z.string().trim().min(1).max(50),
          accountNumber: z.string().trim().max(40),
          enabled: z.boolean(),
        })
      )
      .max(15)
      .optional(),
    banners: z
      .array(
        z.object({
          id: z.string().trim().max(64),
          title: z.string().trim().max(200).optional().default(""),
          subtitle: z.string().trim().max(500).optional().default(""),
          imageUrl: z
            .string()
            .trim()
            .max(2048)
            .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid banner image URL"),
          linkUrl: z
            .string()
            .trim()
            .max(1024)
            .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid banner link URL")
            .optional()
            .default("/shop"),
        })
      )
      .max(20)
      .optional(),
    categories: z
      .array(
        z.object({
          id: z.string().trim().max(64),
          label: z.string().trim().min(1).max(80),
          slug: z.string().trim().max(80).optional().default(""),
        })
      )
      .max(50)
      .optional(),
  })
  .passthrough();

export async function GET() {
  let settings = await storage.getSettings();

  if (!settings || Object.keys(settings).length === 0 || Array.isArray(settings)) {
    settings = defaultSettings;
    await storage.updateSettings(settings);
  }

  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const adminToken = await verifyAdmin(request, { checkRevoked: true });
    if (!adminToken) {
      await logSecurityEvent({
        action: "settings.update",
        severity: "critical",
        ip,
        outcome: "denied",
        reason: "Unauthorized store settings modification attempt",
      });
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 401 }
      );
    }

    const rawData = await request.json();
    const parsed = settingsUpdateSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid settings payload." },
        { status: 400 }
      );
    }

    const data = { ...parsed.data, themeId: "midnight" } as Record<string, any>;
    if (Array.isArray(data.navLinks)) {
      data.navLinks = data.navLinks.filter(
        (l: any) =>
          String(l.href || "").trim().toLowerCase() !== "/cart" &&
          String(l.label || "").trim().toLowerCase() !== "cart"
      );
    }

    const settings = await storage.getSettings();
    const updatedSettings = { ...settings, ...data, themeId: "midnight" };
    await storage.updateSettings(updatedSettings);

    await logSecurityEvent({
      action: "settings.updated",
      severity: "high",
      actorUid: adminToken.uid,
      actorEmail: adminToken.email || null,
      actorRole: "admin",
      ip,
      targetType: "settings",
      targetId: "main",
      outcome: "allowed",
      metadata: { updatedKeys: Object.keys(parsed.data) },
    });

    try {
      revalidatePath("/");
      revalidatePath("/contact");
    } catch {}

    return NextResponse.json(updatedSettings);
  } catch (error: any) {
    console.error("[Settings PUT] Error:", error?.message);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
