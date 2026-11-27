import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { timingSafeSecretEquals } from "@/lib/security/crypto-helpers";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const steadfastWebhookSchema = z.object({
  notification_type: z.string().trim().max(64).optional(),
  consignment_id: z.union([
    z.number().int().positive(),
    z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  ]),
  status: z.string().trim().max(64).optional(),
  tracking_message: z.string().trim().max(500).optional(),
  cod_amount: z.union([z.number(), z.string()]).optional(),
  delivery_charge: z.union([z.number(), z.string()]).optional(),
});

/**
 * POST /api/webhooks/steadfast
 * Authenticated, constant-time verified, idempotent Steadfast Courier webhook handler.
 * Documented at: https://portal.packzy.com/api/v1/webhook_documentation
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // 1. Rate-limit webhook endpoint against flooding
    const rl = await checkRateLimit({
      bucket: "steadfast_webhook",
      identifier: ip,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ status: "error", message: "Too many requests" }, { status: 429 });
    }

    // 2. Require non-empty configured webhook token (NEVER allow `Bearer undefined` when unset)
    const expectedToken = (
      process.env.STEADFAST_WEBHOOK_TOKEN ||
      process.env.STEADFAST_API_KEY ||
      ""
    ).trim();

    if (!expectedToken) {
      console.error("[Steadfast Webhook] Webhook secret token is not configured.");
      return NextResponse.json(
        { status: "error", message: "Webhook service unavailable" },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const providedToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!providedToken || !timingSafeSecretEquals(providedToken, expectedToken)) {
      await logSecurityEvent({
        action: "webhook.steadfast",
        severity: "high",
        ip,
        outcome: "denied",
        reason: "Invalid or missing Steadfast webhook Bearer token",
      });
      return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }

    const rawPayload = await request.json();
    const parsed = steadfastWebhookSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return NextResponse.json({ status: "error", message: "Invalid payload" }, { status: 400 });
    }

    const { notification_type, consignment_id, status, tracking_message } = parsed.data;

    // 3. Look up the order by consignment ID
    const order = await storage.getOrderByConsignmentId(consignment_id);
    if (!order) {
      return NextResponse.json(
        { status: "error", message: "Consignment not matched." },
        { status: 200 }
      );
    }

    const currentOrderStatus = String(order.orderStatus || order.status || "").toLowerCase();
    const currentPayStatus = String(order.paymentStatus || "").toLowerCase();
    const normalizedCourierStatus = status ? status.trim().toLowerCase() : "";

    // 4. Idempotency check: ignore replayed events that carry the exact same courier status & message
    if (
      normalizedCourierStatus &&
      String(order.courierStatus || "").trim().toLowerCase() === normalizedCourierStatus &&
      (!tracking_message || order.lastTrackingMessage === tracking_message)
    ) {
      return NextResponse.json({
        status: "success",
        message: "Duplicate event ignored idempotently.",
      });
    }

    const updateData: Record<string, any> = {
      lastStatusSync: new Date().toISOString(),
    };

    if (tracking_message) {
      updateData.lastTrackingMessage = tracking_message;
    }

    if (notification_type === "delivery_status" && normalizedCourierStatus) {
      updateData.courierStatus = status;

      if (normalizedCourierStatus === "delivered") {
        if (currentOrderStatus !== "cancelled") {
          updateData.orderStatus = "delivered";
          updateData.status = "Delivered";
        }
      } else if (normalizedCourierStatus === "cancelled") {
        // Never allow a courier webhook to cancel an already delivered or refunded order
        if (currentOrderStatus !== "delivered" && currentPayStatus !== "refunded") {
          updateData.orderStatus = "cancelled";
          updateData.status = "Cancelled";
          if (!order.stockRestored) {
            await storage.restoreCancelledOrderStockAtomically(order.id);
            updateData.stockRestored = true;
          }
        }
      }
    }

    await storage.updateOrder(order.id, updateData);

    await logSecurityEvent({
      action: "webhook.steadfast_processed",
      severity: "info",
      ip,
      targetType: "order",
      targetId: order.id,
      outcome: "allowed",
      metadata: {
        notificationType: notification_type || null,
        courierStatus: status || null,
      },
    });

    return NextResponse.json({
      status: "success",
      message: "Webhook received successfully.",
    });
  } catch (error: any) {
    console.error("[Steadfast Webhook] Processing error:", error?.message);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return new Response("OK", { status: 200 });
}
