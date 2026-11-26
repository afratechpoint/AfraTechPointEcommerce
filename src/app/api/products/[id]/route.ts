export const dynamic = 'force-dynamic';
import { verifyAdmin } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { sanitizePublicProduct } from '@/lib/inventory';
import { revalidatePath } from 'next/cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const adminToken = await verifyAdmin(request);
  const products = await storage.getProducts();
  const product = products.find((p: any) => p.id === id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json(adminToken ? product : sanitizePublicProduct(product));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminToken = await verifyAdmin(request);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const data = await request.json();
  const existing = await storage.getProductById(id);

  // Build a clean patch object without spreading Firestore metadata (`id`, `createdAt`) or `undefined` values
  const patchData: Record<string, any> = { ...data };
  delete patchData.id;
  delete patchData.createdAt;

  // If Catalog Form updated product details without sending salePrice, clear old salePrice explicitly with null
  if ("regularPrice" in data && !("salePrice" in data) && existing?.salePrice !== undefined) {
    patchData.salePrice = null;
  }

  if (existing?.virtualConfig && data?.virtualConfig) {
    const nextCfg: Record<string, any> = {
      ...existing.virtualConfig,
      ...data.virtualConfig,
    };
    if (data.virtualConfig.stockMode === undefined && existing.virtualConfig.stockMode !== undefined) {
      nextCfg.stockMode = existing.virtualConfig.stockMode;
    }
    if (data.virtualConfig.licensePool === undefined && existing.virtualConfig.licensePool !== undefined) {
      nextCfg.licensePool = existing.virtualConfig.licensePool;
    }
    if (data.virtualConfig.credentialPool === undefined && existing.virtualConfig.credentialPool !== undefined) {
      nextCfg.credentialPool = existing.virtualConfig.credentialPool;
    }
    Object.keys(nextCfg).forEach((k) => {
      if (nextCfg[k] === undefined) delete nextCfg[k];
    });
    patchData.virtualConfig = nextCfg;
  }

  await storage.updateProduct(id, patchData);

  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/shop/${id}`);

  const updated = await storage.getProductById(id);
  return NextResponse.json({ success: true, product: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminToken = await verifyAdmin(request);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await storage.deleteProduct(id);

    revalidatePath("/");
    revalidatePath("/shop");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[API] Product deletion error:", error.message);
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
