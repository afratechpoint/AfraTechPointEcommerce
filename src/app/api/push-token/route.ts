import { verifyOrderStaff, verifyUser } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";

const pushTokenSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  token: z.string().trim().min(20).max(4096),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = pushTokenSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid uid or push token" }, { status: 400 });
    }

    const { uid, token } = parsed.data;
    const staffToken = await verifyOrderStaff(request);
    const userToken = !staffToken ? await verifyUser(request) : null;

    if (uid === "admin") {
      if (!staffToken) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (!staffToken && (!userToken || userToken.uid !== uid)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await storage.savePushToken(uid, token);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to save push token" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const staffToken = await verifyOrderStaff(request);
    const userToken = !staffToken ? await verifyUser(request) : null;
    const caller = staffToken || userToken;

    if (!caller?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    await storage.deletePushToken(caller.uid, token, Boolean(staffToken));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to remove push token" }, { status: 500 });
  }
}
