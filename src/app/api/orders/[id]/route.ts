export const dynamic = "force-dynamic";
import { verifyAdmin, verifyOrderStaff, verifyUser } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import {
  isSafeHttpUrl,
  patchOrderInputSchema,
  sanitizeOrderForCustomer,
} from "@/lib/security/validation";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import { sendEmail } from "@/lib/email/sendEmail";
import { OrderStatusUpdate, PaymentConfirmed } from "@/emails/renderers/index";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staffCaller = await verifyOrderStaff(request);
  const userCaller = !staffCaller ? await verifyUser(request) : null;

  if (!staffCaller && !userCaller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await storage.getOrderById(id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const isOwner = Boolean(
    userCaller &&
      (order.userId === userCaller.uid ||
        order.uid === userCaller.uid ||
        (userCaller.email &&
          userCaller.email_verified !== false &&
          order.userEmail &&
          String(order.userEmail).trim().toLowerCase() ===
            userCaller.email.trim().toLowerCase()))
  );

  if (!staffCaller && !isOwner) {
    await logSecurityEvent({
      action: "orders.read_idor_attempt",
      severity: "high",
      actorUid: userCaller?.uid || null,
      actorEmail: userCaller?.email || null,
      ip: getClientIp(request),
      targetType: "order",
      targetId: id,
      outcome: "denied",
      reason: "Customer attempted to access an order owned by another user",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!staffCaller) {
    return NextResponse.json(sanitizeOrderForCustomer(order));
  }

  return NextResponse.json(order);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const staffCaller = await verifyOrderStaff(request, { checkRevoked: true });
  if (!staffCaller) {
    await logSecurityEvent({
      action: "orders.patch",
      severity: "high",
      ip,
      outcome: "denied",
      reason: "Unauthorized attempt to update order status/payment",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const oldOrder = await storage.getOrderById(id);
    if (!oldOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const rawBody = await request.json();
    const parsed = patchOrderInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid order update payload." },
        { status: 400 }
      );
    }

    const body: Record<string, any> = { ...parsed.data };
    const oldPayStatus = String(oldOrder.paymentStatus || "pending").toLowerCase();

    // 1. Validate software download links inside deliveries to prevent `javascript:` URI injection
    if (Array.isArray(body.deliveries)) {
      for (const d of body.deliveries) {
        if (d.type === "software" && !isSafeHttpUrl(d.value)) {
          return NextResponse.json(
            { error: "Software download link must start with http:// or https://" },
            { status: 400 }
          );
        }
      }
    }

    // 2. Payment status state-machine protection: refunded orders cannot silently revert to paid/pending
    if (
      oldPayStatus === "refunded" &&
      body.paymentStatus &&
      body.paymentStatus !== "refunded"
    ) {
      return NextResponse.json(
        { error: "A refunded order cannot transition back to a non-refunded payment status." },
        { status: 400 }
      );
    }

    // Only allow refunding orders that actually had digital payment (or were already confirmed)
    if (body.paymentStatus === "refunded") {
      const pmtMethod = oldOrder.payment?.method || oldOrder.paymentMethod || "";
      if (pmtMethod === "Cash on Delivery" && oldPayStatus !== "confirmed") {
        return NextResponse.json(
          { error: "Unpaid Cash on Delivery orders cannot be marked as refunded." },
          { status: 400 }
        );
      }
    }

    // 3. Normalize orderStatus & status
    if (body.orderStatus || body.status) {
      const raw = String(body.orderStatus || body.status).trim().toLowerCase();
      const normalized = raw === "completed" ? "delivered" : raw;
      body.orderStatus = normalized;
      body.status = normalized.charAt(0).toUpperCase() + normalized.slice(1);

      if (
        normalized !== "cancelled" &&
        body.cancellationReason === undefined &&
        oldOrder.cancellationReason
      ) {
        body.cancellationReason = "";
      }
    }

    if (typeof body.cancellationReason === "string") {
      body.cancellationReason = body.cancellationReason.trim();
    }

    // 4. Reveal pre-attached digital deliveries when confirming payment
    if (body.paymentStatus === "confirmed") {
      if (
        !body.deliveries &&
        Array.isArray(oldOrder.deliveries) &&
        oldOrder.deliveries.length > 0
      ) {
        body.deliveries = oldOrder.deliveries.map((d: any) => ({ ...d, revealed: true }));
      }
      const prevOrdStatus = String(oldOrder.orderStatus || oldOrder.status || "pending").toLowerCase();
      if (
        oldPayStatus !== "confirmed" &&
        !body.orderStatus &&
        !body.status &&
        prevOrdStatus === "pending"
      ) {
        body.orderStatus = "processing";
        body.status = "Processing";
      }
    }

    // 5. Atomic, idempotent stock & unrevealed credential restoration on cancellation
    const isBeingCancelled =
      body.paymentStatus === "cancelled" ||
      body.paymentStatus === "failed" ||
      body.orderStatus === "cancelled";

    if (isBeingCancelled && !oldOrder.stockRestored) {
      await storage.restoreCancelledOrderStockAtomically(id);
      body.stockRestored = true;
    }

    await storage.updateOrder(id, body);
    const newOrder = await storage.getOrderById(id);
    if (!newOrder) return NextResponse.json({ error: "Order update failed" }, { status: 500 });

    await logSecurityEvent({
      action: "orders.updated",
      severity: isBeingCancelled || body.paymentStatus === "refunded" ? "high" : "info",
      actorUid: staffCaller.uid,
      actorEmail: staffCaller.email || null,
      actorRole: staffCaller.resolvedRole,
      ip,
      targetType: "order",
      targetId: id,
      outcome: "allowed",
      metadata: {
        prevPaymentStatus: oldOrder.paymentStatus,
        nextPaymentStatus: newOrder.paymentStatus,
        prevOrderStatus: oldOrder.orderStatus,
        nextOrderStatus: newOrder.orderStatus,
        deliveriesUpdated: Boolean(body.deliveries),
      },
    });

    // 6. Non-blocking customer status & payment emails
    try {
      const settings = await storage.getSettings();
      const logoUrl = settings?.logoUrl;
      const shopUrl = settings?.shopUrl;
      const targetEmail = newOrder.userEmail || newOrder.email;
      const promises: Promise<any>[] = [];

      if (targetEmail) {
        if (body.orderStatus && body.orderStatus !== oldOrder.orderStatus) {
          promises.push(
            sendEmail({
              to: targetEmail,
              subject: `Order Update #${newOrder.id.slice(0, 8).toUpperCase()}`,
              template: OrderStatusUpdate,
              props: {
                orderId: newOrder.id,
                status: newOrder.orderStatus,
                trackingInfo: body.trackingNumber || newOrder.trackingNumber,
                logoUrl,
                shopUrl,
              },
            })
          );
        }

        if (body.paymentStatus === "confirmed" && oldOrder.paymentStatus !== "confirmed") {
          promises.push(
            sendEmail({
              to: targetEmail,
              subject: `Payment Confirmed: Order #${newOrder.id.slice(0, 8).toUpperCase()}`,
              template: PaymentConfirmed,
              props: {
                orderId: newOrder.id,
                customerName: newOrder.shippingAddress?.fullName || "Valued Customer",
                logoUrl,
                shopUrl,
              },
            })
          );
        }
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    } catch {
      // Non-blocking email failure
    }

    return NextResponse.json(newOrder);
  } catch (err: any) {
    console.error("[Order PATCH] Error:", err?.message);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  // Permanent order deletion is restricted to full Administrators
  const adminCaller = await verifyAdmin(request, { checkRevoked: true });
  if (!adminCaller) {
    await logSecurityEvent({
      action: "orders.delete",
      severity: "high",
      ip,
      outcome: "denied",
      reason: "Non-admin attempted to delete an order",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await storage.deleteOrder(id);

    await logSecurityEvent({
      action: "orders.deleted",
      severity: "high",
      actorUid: adminCaller.uid,
      actorEmail: adminCaller.email || null,
      actorRole: "admin",
      ip,
      targetType: "order",
      targetId: id,
      outcome: "allowed",
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Order DELETE] Error:", err?.message);
    return NextResponse.json({ error: "Failed to delete order" }, { status: 500 });
  }
}
