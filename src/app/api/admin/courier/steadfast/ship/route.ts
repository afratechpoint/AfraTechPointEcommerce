import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOrderStaff } from "@/lib/auth-server";
import { storage } from "@/lib/storage";
import { steadfast } from "@/lib/courier/steadfast";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

const shipSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  deliveryType: z.union([z.literal(0), z.literal(1)]).optional().default(0),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const staffCaller = await verifyOrderStaff(request, { checkRevoked: true });
  if (!staffCaller) {
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  try {
    const rawBody = await request.json();
    const parsed = shipSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid Order ID is required" }, { status: 400 });
    }

    const { orderId, deliveryType } = parsed.data;
    const order = await storage.getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const ordStatus = String(order.orderStatus || order.status || "").toLowerCase();
    const payStatus = String(order.paymentStatus || "").toLowerCase();

    if (ordStatus === "cancelled" || payStatus === "cancelled" || payStatus === "refunded") {
      return NextResponse.json(
        { error: "Cancelled or refunded orders cannot be dispatched to courier." },
        { status: 400 }
      );
    }

    if (order.courierConsignmentId) {
      return NextResponse.json(
        { error: "This order already has an active Steadfast consignment." },
        { status: 409 }
      );
    }

    const addr = order.shippingAddress || order.customer || {};
    const recipientName = String(addr.fullName || addr.name || "Customer").trim();
    const recipientPhone = String(addr.phone || "").replace(/\D/g, "").slice(-11);
    const recipientAddress = [addr.address, addr.city, addr.postalCode]
      .filter(Boolean)
      .join(", ");

    if (!/^01\d{9}$/.test(recipientPhone)) {
      return NextResponse.json(
        { error: "Order does not have a valid 11-digit recipient phone number." },
        { status: 400 }
      );
    }

    // Only treat as prepaid (COD = 0) when admin explicitly confirmed payment
    const isPrepaid = payStatus === "confirmed";
    const totalAmount = Number(order.totalAmount ?? order.total ?? 0);
    const codAmount = isPrepaid ? 0 : Math.max(0, Math.round(totalAmount));

    const steadfastData = {
      invoice: order.id,
      recipient_name: recipientName.substring(0, 100),
      recipient_phone: recipientPhone,
      recipient_address: recipientAddress.substring(0, 250),
      cod_amount: codAmount,
      note: `Order #${order.id.slice(0, 8)}`,
      item_description:
        order.items?.map((i: any) => i.name).join(", ").substring(0, 250) || "Electronics",
      delivery_type: deliveryType,
    };

    const result = await steadfast.createOrder(steadfastData);

    if (result.status === 200 && result.consignment) {
      const updateData = {
        courier: "Steadfast",
        courierTrackingCode: result.consignment.tracking_code,
        courierConsignmentId: result.consignment.consignment_id,
        courierStatus: result.consignment.status,
        orderStatus: "shipped",
        status: "Shipped",
        shippedAt: new Date().toISOString(),
      };

      await storage.updateOrder(orderId, updateData);

      await logSecurityEvent({
        action: "courier.steadfast_ship",
        severity: "info",
        actorUid: staffCaller.uid,
        actorEmail: staffCaller.email || null,
        actorRole: staffCaller.resolvedRole,
        ip,
        targetType: "order",
        targetId: orderId,
        outcome: "allowed",
        metadata: {
          consignmentId: result.consignment.consignment_id,
          codAmount,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Parcel booked successfully",
        trackingCode: result.consignment.tracking_code,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: result.message || "Failed to create parcel in Steadfast",
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[Steadfast Ship API] Error:", error?.message);
    return NextResponse.json({ error: "Failed to book courier shipment." }, { status: 500 });
  }
}
