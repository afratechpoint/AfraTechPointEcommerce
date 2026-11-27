export const dynamic = "force-dynamic";
import { verifyCatalogStaff } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { sanitizePublicProduct } from "@/lib/inventory";
import { isSafeHttpUrl, isSafeUrlOrRelativePath } from "@/lib/security/validation";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import { revalidatePath } from "next/cache";

const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Product name is required").max(250),
    regularPrice: z.number().nonnegative().max(10_000_000).optional(),
    salePrice: z.number().nonnegative().max(10_000_000).nullable().optional(),
    price: z.number().nonnegative().max(10_000_000).optional(),
    stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
    category: z.string().trim().max(100).optional(),
    description: z.string().max(20000).optional(),
    image: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => !v || isSafeUrlOrRelativePath(v), "Invalid product image URL")
      .optional(),
    images: z
      .array(z.string().trim().max(2048).refine((v) => !v || isSafeUrlOrRelativePath(v)))
      .max(30)
      .optional(),
    productKind: z.enum(["physical", "virtual"]).optional(),
    virtualType: z.enum(["social", "account", "license", "software"]).nullable().optional(),
    variants: z.array(z.any()).max(100).optional(),
    virtualConfig: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const staffCaller = await verifyCatalogStaff(request);
  const products = await storage.getProducts();
  if (staffCaller) {
    return NextResponse.json(products);
  }
  return NextResponse.json(products.map((p: any) => sanitizePublicProduct(p)));
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const staffCaller = await verifyCatalogStaff(request, { checkRevoked: true });
  if (!staffCaller) {
    await logSecurityEvent({
      action: "products.create",
      severity: "high",
      ip,
      outcome: "denied",
      reason: "Unauthorized product creation attempt",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawData = await request.json();
    const parsed = createProductSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid product data." },
        { status: 400 }
      );
    }

    const data = { ...parsed.data } as Record<string, any>;
    delete data.id;
    delete data.createdAt;

    if (
      data.virtualConfig?.downloadUrl &&
      !isSafeHttpUrl(data.virtualConfig.downloadUrl)
    ) {
      return NextResponse.json(
        { error: "Software download URL must start with http:// or https://" },
        { status: 400 }
      );
    }

    const newProduct = await storage.createProduct(data);

    await logSecurityEvent({
      action: "products.created",
      severity: "info",
      actorUid: staffCaller.uid,
      actorEmail: staffCaller.email || null,
      actorRole: staffCaller.resolvedRole,
      ip,
      targetType: "product",
      targetId: newProduct.id,
      outcome: "allowed",
      metadata: { name: newProduct.name, productKind: newProduct.productKind || "physical" },
    });

    try {
      revalidatePath("/");
      revalidatePath("/shop");
    } catch {}

    return NextResponse.json(newProduct);
  } catch (err: any) {
    console.error("[Products POST] Error:", err?.message);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
