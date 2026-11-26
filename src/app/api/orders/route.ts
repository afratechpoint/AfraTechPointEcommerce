import { verifyAdmin, verifyUser } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import {
  getAvailableStock,
  hasPerVariantStock,
  resolveVirtualStockMode,
} from '@/lib/inventory';

export const dynamic = 'force-dynamic';
import { sendEmail } from "@/lib/email/sendEmail";
import { OrderConfirmation, NewOrderAdminNotification } from "@/emails/renderers/index";

// ── Order Creation Rate Limiter (per-IP) ─────────────────────────────
// Max 10 order attempts per 10 minutes — prevents bot flooding
const ORDER_RATE_WINDOW = 10 * 60 * 1000;
const ORDER_RATE_MAX    = 10;
const orderRateMap      = new Map<string, { count: number; firstAt: number }>();

function checkOrderRateLimit(ip: string) {
  const now  = Date.now();
  const data = orderRateMap.get(ip);
  if (!data || now - data.firstAt > ORDER_RATE_WINDOW) {
    orderRateMap.set(ip, { count: 1, firstAt: now });
    return true;
  }
  if (data.count >= ORDER_RATE_MAX) return false;
  data.count++;
  return true;
}
// ─────────────────────────────────────────────────────────────────────


export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId        = searchParams.get('userId');
  const all           = searchParams.get('all');

  // ── Protection ──
  // If requesting 'all' or no userId, must be admin.
  // If requesting specific userId, must be that user or an admin.
  const adminToken = await verifyAdmin(request);
  const userToken = !adminToken ? await verifyUser(request) : null;

  if (all || !userId) {
    if (!adminToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else if (userId) {
    if (!adminToken && (!userToken || userToken.uid !== userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // getOrders handles both filtering and all
  const orders = await storage.getOrders({ userId: userId && !all ? userId : undefined });

  let result = orders;
  const paymentStatus = searchParams.get('paymentStatus');
  const orderStatus   = searchParams.get('orderStatus');

  if (paymentStatus) {
    result = result.filter((o: any) => o.paymentStatus === paymentStatus);
  }
  if (orderStatus) {
    result = result.filter((o: any) => o.orderStatus === orderStatus);
  }

  // Sort newest first
  result = result.sort((a: any, b: any) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate Limit ────────────────────────────────────────────────────
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (!checkOrderRateLimit(ip)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }
    // ────────────────────────────────────────────────────────────────

    // ── Require authenticated user to place an order ──────────────────
    const userToken = await verifyUser(request);
    if (!userToken) {
      return NextResponse.json({ error: "You must be logged in to place an order." }, { status: 401 });
    }
    // ────────────────────────────────────────────────────────────────

    const body = await request.json();
    const { items, shippingAddress, payment, userId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Invalid items" }, { status: 400 });
    }

    // ── Server-Side Price Calculation (SECURITY FIX) ──
    const allProducts = await storage.getProducts();
    const settings = await storage.getSettings();

    // Determine shipping from the server-side product records (never trust
    // the client's productKind). Virtual-only orders have no delivery fee.
    const hasPhysical = items.some((item: any) => {
      const p = allProducts.find((prod: any) => prod.id === item.productId);
      const kind = p?.productKind || item.productKind || "physical";
      return kind === "physical";
    });
    const hasVirtual = items.some((item: any) => {
      const p = allProducts.find((prod: any) => prod.id === item.productId);
      const kind = p?.productKind || item.productKind || "physical";
      return kind === "virtual";
    });

    if (
      hasVirtual &&
      (!payment?.method ||
        payment.method === "Cash on Delivery" ||
        !payment?.senderNumber?.trim() ||
        !payment?.transactionId?.trim())
    ) {
      return NextResponse.json(
        { error: "Digital payment is required for virtual products." },
        { status: 400 }
      );
    }

    const isCodOrder = payment?.method === "Cash on Delivery";
    if (!isCodOrder && !/^\d{11}$/.test(String(payment?.senderNumber || "").trim())) {
      return NextResponse.json(
        { error: "Sender number must be exactly 11 digits." },
        { status: 400 }
      );
    }
    if (hasPhysical && !/^\d{11}$/.test(String(shippingAddress?.phone || "").trim())) {
      return NextResponse.json(
        { error: "Shipping phone number must be exactly 11 digits." },
        { status: 400 }
      );
    }

    const deliveryCharge = hasPhysical ? (Number(settings?.deliveryCharge) || 0) : 0;

    let calculatedSubtotal = 0;
    const validatedItems = items.map((item: any) => {
      const product = allProducts.find((p: any) => p.id === item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }

      let price = product.salePrice || product.regularPrice || product.price || 0;
      
      // If variant is selected, check variant price
      if (item.variantName && product.variants) {
        const variant = product.variants.find((v: any) => v.name === item.variantName);
        if (variant) {
          price = variant.salePrice ?? variant.regularPrice ?? price;
        }
      }

      const quantity = Math.max(1, Number(item.quantity) || 1);
      calculatedSubtotal += price * quantity;

      return {
        productId: item.productId,
        name: product.name,
        price: price, // Use server price
        quantity: quantity,
        image: product.image,
        variantName: item.variantName || null,
        productKind: product.productKind || "physical",
        virtualType: product.virtualType || null,
      };
    });

    const calculatedTotal = calculatedSubtotal + deliveryCharge;

    // ── Server-Side Stock Validation (Physical & Virtual) ──
    const requestedByKey = new Map<string, { product: any; variantName: string | null; qty: number }>();
    for (const vItem of validatedItems) {
      const product = allProducts.find((p: any) => p.id === vItem.productId);
      if (!product) continue;
      const key = `${vItem.productId}::${vItem.variantName || ""}`;
      const prev = requestedByKey.get(key);
      requestedByKey.set(key, {
        product,
        variantName: vItem.variantName || null,
        qty: (prev?.qty || 0) + (vItem.quantity || 1),
      });
    }

    let stockError: string | null = null;
    requestedByKey.forEach(({ product, variantName, qty }) => {
      if (stockError) return;
      const avail = getAvailableStock(product, variantName);
      if (avail !== null && qty > avail) {
        const label = variantName ? `${product.name} (${variantName})` : product.name;
        stockError =
          avail <= 0
            ? `"${label}" is Stock Out.`
            : `Only ${avail} left in stock for "${label}".`;
      }
    });

    if (stockError) {
      return NextResponse.json({ error: stockError }, { status: 400 });
    }

    // ── Auto-deduct Stock & Prepare Deliverables (License Keys, Pre-stocked Accounts, Software) ──
    const deliveries: any[] = [];
    // Work on cloned product map so multi-item orders for the same product accumulate cleanly
    const mutableProducts = new Map<string, any>();
    const dirtyProductIds = new Set<string>();
    const getMutableProd = (id: string) => {
      if (!mutableProducts.has(id)) {
        const orig = allProducts.find((p: any) => p.id === id);
        if (orig) mutableProducts.set(id, JSON.parse(JSON.stringify(orig)));
      }
      return mutableProducts.get(id);
    };

    for (const vItem of validatedItems) {
      try {
        const product = getMutableProd(vItem.productId);
        if (!product) continue;
        const qty = vItem.quantity || 1;

        if (vItem.productKind === "virtual") {
          const cfg = product.virtualConfig || {};
          const vMode = resolveVirtualStockMode(product);

          if (vItem.virtualType === "license" && vMode === "pool" && Array.isArray(cfg.licensePool)) {
            const varLower = (vItem.variantName || "").trim().toLowerCase();
            // Prefer variant-tagged keys first, then shared untagged keys
            const sortedPool = [...cfg.licensePool].sort((a: any, b: any) => {
              const aMatch = a.variantName && a.variantName.trim().toLowerCase() === varLower ? 0 : 1;
              const bMatch = b.variantName && b.variantName.trim().toLowerCase() === varLower ? 0 : 1;
              return aMatch - bMatch;
            });
            const eligible = sortedPool.filter(
              (k: any) =>
                k?.key?.trim() &&
                (!vItem.variantName || !k.variantName || k.variantName.trim().toLowerCase() === varLower)
            );
            const chosenKeys = eligible.slice(0, qty);
            const chosenIds = new Set(chosenKeys.map((k: any) => k.id));
            const remainingPool = cfg.licensePool.filter((k: any) => !chosenIds.has(k.id));

            product.virtualConfig = { ...cfg, stockMode: "pool", licensePool: remainingPool };
            product.stock = remainingPool.length;
            dirtyProductIds.add(product.id);

            if (chosenKeys.length > 0) {
              deliveries.push({
                productId: vItem.productId,
                itemName: vItem.name,
                variantName: vItem.variantName,
                type: "license",
                value: chosenKeys.map((k: any) => k.key).filter(Boolean).join(" | "),
                note: chosenKeys.map((k: any) => k.note).filter(Boolean).join(" · ") || "",
                revealed: false,
              });
            }
          } else if (
            vItem.virtualType === "account" &&
            vMode === "pool" &&
            Array.isArray(cfg.credentialPool)
          ) {
            const varLower = (vItem.variantName || "").trim().toLowerCase();
            const sortedPool = [...cfg.credentialPool].sort((a: any, b: any) => {
              const aMatch = a.variantName && a.variantName.trim().toLowerCase() === varLower ? 0 : 1;
              const bMatch = b.variantName && b.variantName.trim().toLowerCase() === varLower ? 0 : 1;
              return aMatch - bMatch;
            });
            const eligible = sortedPool.filter(
              (c: any) =>
                c?.email?.trim() &&
                c?.password?.trim() &&
                (!vItem.variantName || !c.variantName || c.variantName.trim().toLowerCase() === varLower)
            );
            const chosenCreds = eligible.slice(0, qty);
            const chosenIds = new Set(chosenCreds.map((c: any) => c.id));
            const remainingPool = cfg.credentialPool.filter((c: any) => !chosenIds.has(c.id));

            product.virtualConfig = { ...cfg, stockMode: "pool", credentialPool: remainingPool };
            product.stock = remainingPool.length;
            dirtyProductIds.add(product.id);

            chosenCreds.forEach((cred: any) => {
              deliveries.push({
                productId: vItem.productId,
                itemName: vItem.name,
                variantName: vItem.variantName,
                type: "account",
                value: cred.email,
                password: cred.password,
                note: cred.note || "",
                revealed: false,
              });
            });
          } else if (vMode === "quantity") {
            if (hasPerVariantStock(product) && vItem.variantName) {
              product.variants = product.variants.map((vr: any) =>
                vr.name.trim().toLowerCase() === vItem.variantName.trim().toLowerCase() &&
                vr.stock !== undefined &&
                vr.stock !== null
                  ? { ...vr, stock: Math.max(0, Number(vr.stock) - qty) }
                  : vr
              );
              product.stock = product.variants.reduce(
                (s: number, vr: any) => s + (Number(vr.stock) || 0),
                0
              );
              dirtyProductIds.add(product.id);
            } else if (product.stock !== undefined && product.stock !== null) {
              product.stock = Math.max(0, Number(product.stock) - qty);
              dirtyProductIds.add(product.id);
            }
          }

          if (vItem.virtualType === "software" && cfg.downloadUrl) {
            deliveries.push({
              productId: vItem.productId,
              itemName: vItem.name,
              variantName: vItem.variantName,
              type: "software",
              value: cfg.downloadUrl,
              note: [cfg.version, cfg.fileSize].filter(Boolean).join(" · ") || "",
              revealed: false,
            });
          }
        } else {
          // Physical product stock deduction
          if (hasPerVariantStock(product) && vItem.variantName) {
            product.variants = product.variants.map((vr: any) =>
              vr.name.trim().toLowerCase() === vItem.variantName.trim().toLowerCase() &&
              vr.stock !== undefined &&
              vr.stock !== null
                ? { ...vr, stock: Math.max(0, Number(vr.stock) - qty) }
                : vr
            );
            const allTracked = product.variants.every(
              (vr: any) => vr.stock !== undefined && vr.stock !== null
            );
            if (allTracked) {
              product.stock = product.variants.reduce(
                (s: number, vr: any) => s + (Number(vr.stock) || 0),
                0
              );
            }
            dirtyProductIds.add(product.id);
          } else if (product.stock !== undefined && product.stock !== null) {
            product.stock = Math.max(0, Number(product.stock) - qty);
            dirtyProductIds.add(product.id);
          }
        }
      } catch (poolErr) {
        console.warn("[Orders] Could not deduct stock / prepare deliverable:", poolErr);
      }
    }

    // Persist updated stock / pools to storage
    const dirtyIds = Array.from(dirtyProductIds);
    for (let i = 0; i < dirtyIds.length; i++) {
      const pid = dirtyIds[i];
      const updatedProd = mutableProducts.get(pid);
      if (updatedProd) {
        await storage.updateProduct(pid, {
          stock: updatedProd.stock,
          ...(updatedProd.variants ? { variants: updatedProd.variants } : {}),
          ...(updatedProd.virtualConfig ? { virtualConfig: updatedProd.virtualConfig } : {}),
        });
      }
    }

    const customerEmail = userToken?.email || body.userEmail || body.email || body.customer?.email;

    // storage.createOrder handles ID generation and persistence
    const newOrder = await storage.createOrder({
      userId: userId || "guest",
      userEmail: customerEmail, // Save the customer's email
      items: validatedItems,
      shippingAddress,
      payment: payment || { method: "Cash on Delivery" },
      subtotal: calculatedSubtotal,
      deliveryCharge: deliveryCharge,
      total: calculatedTotal,
      totalAmount: calculatedTotal,
      hasPhysical,
      stockDeducted: true,
      fulfillment: body.fulfillment || null,
      deliveries,
      paymentStatus: body.paymentStatus ?? 'pending',
      orderStatus:   body.orderStatus   ?? 'processing',
      status:        body.status        ?? 'Processing',
      createdAt: new Date().toISOString(),
    });

    // ── Send Email Notifications ─────────────────────────────────────
    // We use Promise.allSettled to ensure that even if emails fail 
    // (e.g., missing SMTP config or network issues), the order creation proceeds.
    try {
      const settings = await storage.getSettings();
      const adminEmail = settings?.adminEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || "info@afratechpoint.shop";
      const customerEmail = body.userEmail || body.email || body.customer?.email;
      
      const logoUrl = settings?.logoUrl;
      const shopUrl = settings?.shopUrl;

      if (customerEmail) {
        const discountAmount = Number(body.discount) || 0;
        const results = await Promise.allSettled([
          // 1. Sent to Customer
          sendEmail({
            to: customerEmail,
            subject: `Order Confirmation #${newOrder.id.slice(0, 8).toUpperCase()}`,
            template: OrderConfirmation,
            props: {
              customerName: shippingAddress?.fullName || body.customer?.name || 'Customer',
              orderId: newOrder.id,
              items: validatedItems,
              total: calculatedTotal,
              deliveryCharge: deliveryCharge,
              discount: discountAmount,
              paymentMethod: payment?.method || "Cash on Delivery",
              shippingAddress: shippingAddress,
              orderDate: newOrder.createdAt,
              logoUrl,
              shopUrl
            }
          }),
          // 2. Sent to Administrator
          sendEmail({
            to: adminEmail,
            subject: `New Order Received: #${newOrder.id.slice(0, 8).toUpperCase()}`,
            template: NewOrderAdminNotification,
            props: {
              orderId: newOrder.id,
              customerName: shippingAddress?.fullName || body.customer?.name || 'Customer',
              customerEmail: customerEmail,
              total: calculatedTotal,
              items: validatedItems,
              deliveryCharge: deliveryCharge,
              discount: discountAmount,
              paymentMethod: payment?.method || "Cash on Delivery",
              shippingAddress: shippingAddress,
              logoUrl,
              shopUrl
            }
          })
        ]);

        results.forEach((res, i) => {
          if (res.status === 'rejected') {
            console.error(`Order Email ${i} failed:`, res.reason);
          } else {
            console.log(`Order Email ${i} sent successfully.`);
          }
        });
      } else {
        console.warn("No customer email found in order payload. Skipping customer notification.");
      }
    } catch (emailErr) {
      console.warn("Non-blocking email notification failure:", emailErr);
    }

    return NextResponse.json(newOrder, { status: 201 });
  } catch (err: any) {
    console.error("Order creation error:", err);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
