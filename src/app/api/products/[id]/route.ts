export const dynamic = "force-dynamic";
import { verifyCatalogStaff } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { sanitizePublicProduct } from "@/lib/inventory";
import { isSafeHttpUrl, isSafeUrlOrRelativePath } from "@/lib/security/validation";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import { revalidatePath } from "next/cache";

const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(250).optional(),
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
    variants: z.array(z.any()).max(100).optional(),
    virtualConfig: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const staffCaller = await verifyCatalogStaff(request);
  const products = await storage.getProducts();
  const product = products.find((p: any) => p.id === id);

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json(staffCaller ? product : sanitizePublicProduct(product));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const staffCaller = await verifyCatalogStaff(request, { checkRevoked: true });
  if (!staffCaller) {
    await logSecurityEvent({
      action: "products.update",
      severity: "high",
      ip,
      outcome: "denied",
      reason: "Unauthorized product/inventory update attempt",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const rawData = await request.json();
    const parsed = updateProductSchema.safeParse(rawData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid product update payload." },
        { status: 400 }
      );
    }

    const data = parsed.data as Record<string, any>;
    if (
      data.virtualConfig?.downloadUrl &&
      !isSafeHttpUrl(data.virtualConfig.downloadUrl)
    ) {
      return NextResponse.json(
        { error: "Software download URL must start with http:// or https://" },
        { status: 400 }
      );
    }

    const existing = await storage.getProductById(id);
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const patchData: Record<string, any> = { ...data };
    delete patchData.id;
    delete patchData.createdAt;

    if ("regularPrice" in data && !("salePrice" in data) && existing?.salePrice !== undefined) {
      patchData.salePrice = null;
    }

    if (existing?.virtualConfig && data?.virtualConfig) {
      const nextCfg: Record<string, any> = {
        ...existing.virtualConfig,
        ...data.virtualConfig,
      };
      if (
        data.virtualConfig.stockMode === undefined &&
        existing.virtualConfig.stockMode !== undefined
      ) {
        nextCfg.stockMode = existing.virtualConfig.stockMode;
      }
      if (
        data.virtualConfig.licensePool === undefined &&
        existing.virtualConfig.licensePool !== undefined
      ) {
        nextCfg.licensePool = existing.virtualConfig.licensePool;
      }
      if (
        data.virtualConfig.credentialPool === undefined &&
        existing.virtualConfig.credentialPool !== undefined
      ) {
        nextCfg.credentialPool = existing.virtualConfig.credentialPool;
      }
      Object.keys(nextCfg).forEach((k) => {
        if (nextCfg[k] === undefined) delete nextCfg[k];
      });
      patchData.virtualConfig = nextCfg;
    }

    await storage.updateProduct(id, patchData);

    await logSecurityEvent({
      action: "products.updated",
      severity: "info",
      actorUid: staffCaller.uid,
      actorEmail: staffCaller.email || null,
      actorRole: staffCaller.resolvedRole,
      ip,
      targetType: "product",
      targetId: id,
      outcome: "allowed",
      metadata: {
        updatedFields: Object.keys(patchData),
      },
    });

    try {
      revalidatePath("/");
      revalidatePath("/shop");
      revalidatePath(`/shop/${id}`);
    } catch {}

    const updated = await storage.getProductById(id);
    return NextResponse.json({ success: true, product: updated });
  } catch (err: any) {
    console.error("[Product PUT] Error:", err?.message);
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const staffCaller = await verifyCatalogStaff(request, { checkRevoked: true });
  if (!staffCaller) {
    await logSecurityEvent({
      action: "products.delete",
      severity: "high",
      ip,
      outcome: "denied",
      reason: "Unauthorized product deletion attempt",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await storage.deleteProduct(id);

    await logSecurityEvent({
      action: "products.deleted",
      severity: "high",
      actorUid: staffCaller.uid,
      actorEmail: staffCaller.email || null,
      actorRole: staffCaller.resolvedRole,
      ip,
      targetType: "product",
      targetId: id,
      outcome: "allowed",
    });

    try {
      revalidatePath("/");
      revalidatePath("/shop");
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[API] Product deletion error:", error?.message);
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
