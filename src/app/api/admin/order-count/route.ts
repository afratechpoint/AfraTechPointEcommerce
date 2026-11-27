import { verifyOrderStaff } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const staffToken = await verifyOrderStaff(request);
    if (!staffToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const count = await storage.getPendingOrdersCount();
    return NextResponse.json({ count });
  } catch (error: any) {
    console.error("[API Order Count Error]:", error?.message);
    return NextResponse.json({ error: "Failed to fetch order count" }, { status: 500 });
  }
}
