import { NextRequest, NextResponse } from "next/server";
import { verifyOrderStaff } from "@/lib/auth-server";
import { storage } from "@/lib/storage";
import { steadfast } from "@/lib/courier/steadfast";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const staffCaller = await verifyOrderStaff(request);
  if (!staffCaller) {
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  try {
    const { orderId } = await params;
    if (!orderId || orderId.length > 128) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
    }

    const order = await storage.getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const consignmentId = order.courierConsignmentId || order.courierTrackingCode;
    if (!consignmentId) {
      return NextResponse.json(
        { error: "This order has not been shipped via courier yet" },
        { status: 400 }
      );
    }

    const result = await steadfast.getStatusById(consignmentId);

    if (result.status === 200 && result.delivery_status) {
      const newStatus = String(result.delivery_status);
      const updateData: Record<string, any> = {
        courierStatus: newStatus,
        lastStatusSync: new Date().toISOString(),
      };

      if (
        newStatus.toLowerCase() === "delivered" &&
        String(order.orderStatus || "").toLowerCase() !== "cancelled"
      ) {
        updateData.orderStatus = "delivered";
        updateData.status = "Delivered";
      }

      await storage.updateOrder(orderId, updateData);

      return NextResponse.json({
        success: true,
        status: newStatus,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Could not fetch status from Steadfast",
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[Steadfast Status API] Error:", error?.message);
    return NextResponse.json({ error: "Courier status check failed." }, { status: 500 });
  }
}
