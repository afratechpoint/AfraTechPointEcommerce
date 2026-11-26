export const dynamic = 'force-dynamic';
import { verifyAdmin, verifyUser } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { hasPerVariantStock, resolveVirtualStockMode } from '@/lib/inventory';
import { sendEmail } from "@/lib/email/sendEmail";
import { OrderStatusUpdate, PaymentConfirmed } from "@/emails/renderers/index";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminToken = await verifyAdmin(request);
  const userToken = !adminToken ? await verifyUser(request) : null;

  const { id }  = await params;
  const order = await storage.getOrderById(id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // ── Authorization ──
  // Allow if admin or if the user is the owner.
  // Orders are stored with a `userId` field (Firebase UID). We also check
  // `order.uid` and `order.userEmail` for backwards-compatibility.
  const isOwner = userToken && (
    order.userId   === userToken.uid   ||
    order.uid      === userToken.uid   ||
    order.userEmail === userToken.email
  );

  if (!adminToken && !isOwner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Never expose digital deliverables (accounts / license keys / downloads)
  // to the customer until payment has been confirmed.
  if (!adminToken && order.paymentStatus !== "confirmed" && order.deliveries) {
    const { deliveries, ...safeOrder } = order;
    return NextResponse.json(safeOrder);
  }

  return NextResponse.json(order);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminToken = await verifyAdmin(request);
  if (!adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id }  = await params;
    const oldOrder = await storage.getOrderById(id);
    if (!oldOrder) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const body = await request.json();

    // Normalize orderStatus & status so both fields never drift out of sync
    if (body.orderStatus || body.status) {
      const raw = String(body.orderStatus || body.status).trim().toLowerCase();
      const normalized = raw === "completed" ? "delivered" : raw;
      body.orderStatus = normalized;
      body.status = normalized.charAt(0).toUpperCase() + normalized.slice(1);

      // Clear stale cancellationReason if order is reopened / moved to a non-cancelled state
      if (normalized !== "cancelled" && body.cancellationReason === undefined && oldOrder.cancellationReason) {
        body.cancellationReason = "";
      }
    }

    if (typeof body.cancellationReason === "string") {
      body.cancellationReason = body.cancellationReason.trim();
    }

    // When confirming payment for the first time, auto-reveal pre-attached deliveries
    // and advance pending orders to processing (unless caller explicitly set a status)
    if (body.paymentStatus === "confirmed") {
      if (
        !body.deliveries &&
        Array.isArray(oldOrder.deliveries) &&
        oldOrder.deliveries.length > 0
      ) {
        body.deliveries = oldOrder.deliveries.map((d: any) => ({ ...d, revealed: true }));
      }
      const prevOrdStatus = (oldOrder.orderStatus || oldOrder.status || "pending").toLowerCase();
      if (
        oldOrder.paymentStatus !== "confirmed" &&
        !body.orderStatus &&
        !body.status &&
        prevOrdStatus === "pending"
      ) {
        body.orderStatus = "processing";
        body.status = "Processing";
      }
    }

    // Restore stock & unrevealed virtual pool items once when an order is cancelled
    const isBeingCancelled =
      body.paymentStatus === "cancelled" ||
      body.paymentStatus === "failed" ||
      body.orderStatus === "cancelled";

    if (isBeingCancelled && !oldOrder.stockRestored) {
      // 1. Return unrevealed pre-reserved License Keys & Account Credentials back to pool
      if (oldOrder.paymentStatus !== "confirmed" && Array.isArray(oldOrder.deliveries)) {
        for (const d of oldOrder.deliveries) {
          if (!d.productId || d.revealed) continue;
          try {
            const prod = await storage.getProductById(d.productId);
            if (!prod) continue;
            const cfg = prod.virtualConfig || {};

            if (d.type === "license" && d.value) {
              const restoredKeys = String(d.value)
                .split("|")
                .map((k: string) => k.trim())
                .filter(Boolean)
                .map((key, idx) => ({
                  id: `restored_${Date.now()}_${idx}`,
                  key,
                  ...(d.note ? { note: d.note } : {}),
                  ...(d.variantName ? { variantName: d.variantName } : {}),
                }));
              const nextPool = [...restoredKeys, ...(cfg.licensePool || [])];
              await storage.updateProduct(prod.id, {
                ...(resolveVirtualStockMode(prod) === "pool" ? { stock: nextPool.length } : {}),
                virtualConfig: { ...cfg, licensePool: nextPool },
              });
            } else if (d.type === "account" && d.value && d.password) {
              const nextPool = [
                {
                  id: `restored_acc_${Date.now()}`,
                  email: String(d.value).trim(),
                  password: String(d.password).trim(),
                  ...(d.note ? { note: d.note } : {}),
                  ...(d.variantName ? { variantName: d.variantName } : {}),
                },
                ...(cfg.credentialPool || []),
              ];
              await storage.updateProduct(prod.id, {
                ...(resolveVirtualStockMode(prod) === "pool" ? { stock: nextPool.length } : {}),
                virtualConfig: { ...cfg, credentialPool: nextPool },
              });
            }
          } catch {}
        }
      }

      // 2. Restore numeric stock for Physical & Virtual Quantity-mode items (if order deducted stock)
      if (oldOrder.stockDeducted && Array.isArray(oldOrder.items)) {
        for (const item of oldOrder.items) {
          if (!item.productId) continue;
          try {
            const prod = await storage.getProductById(item.productId);
            if (!prod) continue;
            const qty = Math.max(1, Number(item.quantity) || 1);

            if (prod.productKind === "virtual" && resolveVirtualStockMode(prod) !== "quantity") {
              continue;
            }

            if (hasPerVariantStock(prod) && item.variantName && Array.isArray(prod.variants)) {
              const nextVariants = prod.variants.map((vr: any) =>
                vr.name.trim().toLowerCase() === String(item.variantName).trim().toLowerCase() &&
                vr.stock !== undefined &&
                vr.stock !== null
                  ? { ...vr, stock: Math.max(0, Number(vr.stock) + qty) }
                  : vr
              );
              const allTracked = nextVariants.every(
                (vr: any) => vr.stock !== undefined && vr.stock !== null
              );
              await storage.updateProduct(prod.id, {
                variants: nextVariants,
                ...(allTracked
                  ? {
                      stock: nextVariants.reduce(
                        (s: number, vr: any) => s + (Number(vr.stock) || 0),
                        0
                      ),
                    }
                  : {}),
              });
            } else if (prod.stock !== undefined && prod.stock !== null) {
              await storage.updateProduct(prod.id, {
                stock: Math.max(0, Number(prod.stock) + qty),
              });
            }
          } catch {}
        }
      }

      body.stockRestored = true;
    }

    await storage.updateOrder(id, body);
    const newOrder = await storage.getOrderById(id);
    if (!newOrder) return NextResponse.json({ error: 'Order update failed' }, { status: 500 });

    // ── Send Email Notifications ─────────────────────────────────────
    try {
      const settings = await storage.getSettings();
      const logoUrl = settings?.logoUrl;
      const shopUrl = settings?.shopUrl;
      const promises: Promise<any>[] = [];


      // 1. Order Status Update
      if (body.orderStatus && body.orderStatus !== oldOrder.orderStatus) {
        promises.push(sendEmail({
          to: newOrder.userEmail || newOrder.email,
          subject: `Order Update #${newOrder.id.slice(0, 8).toUpperCase()}`,
          template: OrderStatusUpdate,
          props: {
            orderId: newOrder.id,
            status: newOrder.orderStatus,
            trackingInfo: body.trackingNumber || newOrder.trackingNumber,
            logoUrl,
            shopUrl
          }
        }));
      }

      // 2. Payment Confirmation
      if (body.paymentStatus === 'confirmed' && oldOrder.paymentStatus !== 'confirmed') {
        promises.push(sendEmail({
          to: newOrder.userEmail || newOrder.email,
          subject: `Payment Confirmed: Order #${newOrder.id.slice(0, 8).toUpperCase()}`,
          template: PaymentConfirmed,
          props: {
            orderId: newOrder.id,
            customerName: newOrder.shippingAddress?.fullName || 'Valued Customer',
            logoUrl,
            shopUrl
          }
        }));
      }

      if (promises.length > 0) {
        const results = await Promise.allSettled(promises);
        results.forEach((res, i) => {
          if (res.status === 'rejected') {
            console.error(`Email ${i} failed:`, res.reason);
          } else {
            console.log(`Email ${i} sent successfully.`);
          }
        });
      }
    } catch (emailErr) {
      console.warn("Non-blocking status update email failure:", emailErr);
    }

    return NextResponse.json(newOrder);
  } catch (err: any) {
    console.error("Order update error:", err);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
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
    await storage.deleteOrder(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Order deletion error:", err);
    return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
  }
}
