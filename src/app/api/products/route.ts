export const dynamic = 'force-dynamic';
import { verifyAdmin } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { sanitizePublicProduct } from '@/lib/inventory';

import { revalidatePath } from 'next/cache';

export async function GET(request: NextRequest) {
  const adminToken = await verifyAdmin(request);
  const products = await storage.getProducts();
  if (adminToken) {
    return NextResponse.json(products);
  }
  return NextResponse.json(products.map((p: any) => sanitizePublicProduct(p)));
}

export async function POST(request: NextRequest) {
  const adminToken = await verifyAdmin(request);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await request.json();
  const newProduct = await storage.createProduct(data);
  
  revalidatePath("/");
  revalidatePath("/shop");
  
  return NextResponse.json(newProduct);
}
