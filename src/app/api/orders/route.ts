import { verifyOrderStaff, verifyUser } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { OrderBusinessError } from "@/lib/firebase/server_firestore";
import {
  createOrderInputSchema,
  sanitizeOrderForCustomer,
} from "@/lib/security/validation";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import { sendEmail } from "@/lib/email/sendEmail";
import { OrderConfirmation, NewOrderAdminNotification } from "@/emails/renderers/index";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const all = searchParams.get("all");

  const staffCaller = await verifyOrderStaff(request);
  const userCaller = !staffCaller ? await verifyUser(request) : null;

  if (all || !userId) {
    if (!staffCaller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!staffCaller) {
    if (!userCaller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (userCaller.uid !== userId) {
      await logSecurityEvent({
        action: "orders.list_bola_attempt",
        severity: "high",
        actorUid: userCaller.uid,
        actorEmail: userCaller.email || null,
        ip: getClientIp(request),
        targetType: "user_orders",
        targetId: userId,
        outcome: "denied",
        reason: "Customer attempted to read another customer's order history",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const orders = await storage.getOrders({ userId: userId && !all ? userId : undefined });

  let result = orders;
  const paymentStatus = searchParams.get("paymentStatus");
  const orderStatus = searchParams.get("orderStatus");

  if (paymentStatus) {
    result = result.filter((o: any) => o.paymentStatus === paymentStatus);
  }
  if (orderStatus) {
    result = result.filter((o: any) => o.orderStatus === orderStatus);
  }

  result = result.sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // CRITICAL: Strip unconfirmed digital deliverables (`deliveries`) when returning orders to non-staff
  if (!staffCaller) {
    result = result.map((o: any) => sanitizeOrderForCustomer(o));
  }

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // 1. Distributed IP rate limit
    const ipLimit = await checkRateLimit({
      bucket: "order_create_ip",
      identifier: ip,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many order requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    // 2. Require authenticated customer
    const userToken = await verifyUser(request);
    if (!userToken?.uid) {
      return NextResponse.json(
        { error: "You must be logged in to place an order." },
        { status: 401 }
      );
    }

    // 3. Per-user rate limit
    const userLimit = await checkRateLimit({
      bucket: "order_create_user",
      identifier: userToken.uid,
      limit: 8,
      windowMs: 10 * 60 * 1000,
    });
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: "Too many orders placed recently. Please wait a few minutes." },
        { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds) } }
      );
    }

    // 4. Reject oversized request payloads (> 64 KB)
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 64 * 1024) {
      return NextResponse.json({ error: "Order payload too large." }, { status: 413 });
    }

    const rawBody = await request.json();

    // Log any attempt to spoof another userId or inject paid status
    if (
      (rawBody?.userId && rawBody.userId !== userToken.uid) ||
      rawBody?.paymentStatus === "confirmed" ||
      rawBody?.paymentStatus === "paid" ||
      rawBody?.orderStatus === "delivered" ||
      rawBody?.orderStatus === "completed" ||
      Array.isArray(rawBody?.deliveries)
    ) {
      await logSecurityEvent({
        action: "orders.tamper_attempt",
        severity: "critical",
        actorUid: userToken.uid,
        actorEmail: userToken.email || null,
        ip,
        outcome: "denied",
        reason: "Client supplied forged userId, paid paymentStatus, delivered status, or deliveries",
        metadata: {
          suppliedUserId: rawBody?.userId,
          suppliedPaymentStatus: rawBody?.paymentStatus,
          suppliedOrderStatus: rawBody?.orderStatus,
        },
      });
    }

    const parsed = createOrderInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid checkout payload." },
        { status: 400 }
      );
    }

    const settings = await storage.getSettings();
    const customerEmail = (userToken.email || "").trim().toLowerCase();

    // 5. Execute atomic checkout (server-side pricing, variant check, TrxID uniqueness, stock & pool deduction)
    const newOrder = await storage.placeOrderAtomically({
      requestedItems: parsed.data.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantName: i.variantName ?? null,
      })),
      settings,
      userId: userToken.uid, // Derived strictly from verified Firebase ID token
      userEmail: customerEmail,
      shippingAddress: parsed.data.shippingAddress || {},
      payment: parsed.data.payment,
      fulfillment: parsed.data.fulfillment || null,
      customer: parsed.data.customer,
    });

    await logSecurityEvent({
      action: "orders.created",
      severity: "info",
      actorUid: userToken.uid,
      actorEmail: customerEmail || null,
      ip,
      targetType: "order",
      targetId: newOrder.id,
      outcome: "allowed",
      metadata: {
        totalAmount: newOrder.totalAmount,
        paymentMethod: newOrder.payment?.method,
        itemCount: newOrder.items?.length || 0,
      },
    });

    // 6. Non-blocking confirmation emails using trusted server values only
    try {
      const adminEmail =
        settings?.adminEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || "";
      const logoUrl = settings?.logoUrl;
      const shopUrl = settings?.shopUrl;
      const recipientName =
        newOrder.shippingAddress?.fullName || parsed.data.customer?.name || "Customer";

      const emailJobs: Promise<any>[] = [];
      if (customerEmail) {
        emailJobs.push(
          sendEmail({
            to: customerEmail,
            subject: `Order Confirmation #${newOrder.id.slice(0, 8).toUpperCase()}`,
            template: OrderConfirmation,
            props: {
              customerName: recipientName,
              orderId: newOrder.id,
              items: newOrder.items,
              total: newOrder.totalAmount,
              deliveryCharge: newOrder.deliveryCharge,
              discount: 0,
              paymentMethod: newOrder.payment?.method || "Cash on Delivery",
              shippingAddress: newOrder.shippingAddress,
              orderDate: newOrder.createdAt,
              logoUrl,
              shopUrl,
            },
          })
        );
      }
      if (adminEmail) {
        emailJobs.push(
          sendEmail({
            to: adminEmail,
            subject: `New Order Received: #${newOrder.id.slice(0, 8).toUpperCase()}`,
            template: NewOrderAdminNotification,
            props: {
              orderId: newOrder.id,
              customerName: recipientName,
              customerEmail,
              total: newOrder.totalAmount,
              items: newOrder.items,
              deliveryCharge: newOrder.deliveryCharge,
              discount: 0,
              paymentMethod: newOrder.payment?.method || "Cash on Delivery",
              shippingAddress: newOrder.shippingAddress,
              logoUrl,
              shopUrl,
            },
          })
        );
      }
      if (emailJobs.length > 0) {
        await Promise.allSettled(emailJobs);
      }
    } catch {
      // Non-blocking email failure
    }

    // CRITICAL: Never expose pre-allocated digital credentials in the 201 response before payment verification
    return NextResponse.json(sanitizeOrderForCustomer(newOrder), { status: 201 });
  } catch (err: any) {
    if (err instanceof OrderBusinessError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[Orders POST] Unexpected error:", err?.message);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
