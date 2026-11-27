import { verifyOrderStaff, verifyUser } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recipient = (searchParams.get("recipient") || "admin").trim();
    const parsedLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(100, parsedLimit))
      : 20;

    if (recipient === "admin") {
      const staffToken = await verifyOrderStaff(request);
      if (!staffToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const userToken = await verifyUser(request);
      const staffToken = !userToken ? await verifyOrderStaff(request) : null;
      if (!userToken && !staffToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (userToken && userToken.uid !== recipient) {
        const isStaffAlso = await verifyOrderStaff(request);
        if (!isStaffAlso) {
          await logSecurityEvent({
            action: "notifications.read_bola_attempt",
            severity: "warn",
            actorUid: userToken.uid,
            ip: getClientIp(request),
            targetType: "notifications",
            targetId: recipient,
            outcome: "denied",
            reason: "Customer attempted to read another user's notifications",
          });
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    }

    const notifications = await storage.getNotifications(recipient, limit);
    return NextResponse.json({ notifications: notifications || [] });
  } catch {
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const staffToken = await verifyOrderStaff(request);
    const userToken = !staffToken ? await verifyUser(request) : null;

    if (!staffToken && !userToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, all, recipient } = body || {};

    if (all) {
      const targetRecipient = String(
        recipient || (staffToken ? "admin" : userToken?.uid) || ""
      ).trim();
      if (targetRecipient === "admin" && !staffToken) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!staffToken && userToken && targetRecipient !== userToken.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await storage.markAllNotificationsAsRead(targetRecipient);
    } else if (typeof id === "string" && id.trim()) {
      const cleanId = id.trim();
      const notif = await storage.getNotificationById(cleanId);
      if (!notif) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
      const ownerRecipient = String(notif.recipient || "");
      const canModify =
        ownerRecipient === "admin"
          ? Boolean(staffToken)
          : Boolean(staffToken || (userToken && userToken.uid === ownerRecipient));

      if (!canModify) {
        await logSecurityEvent({
          action: "notifications.modify_idor_attempt",
          severity: "warn",
          actorUid: userToken?.uid || null,
          ip,
          targetType: "notification",
          targetId: cleanId,
          outcome: "denied",
          reason: "Unauthorized attempt to mark another user's/admin's notification read",
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await storage.markNotificationAsRead(cleanId);
    } else {
      return NextResponse.json(
        { error: "Missing notification ID or 'all' flag" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const staffToken = await verifyOrderStaff(request);
    const userToken = !staffToken ? await verifyUser(request) : null;

    if (!staffToken && !userToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    const clearAll = searchParams.get("all");
    const recipient = (
      searchParams.get("recipient") ||
      (staffToken ? "admin" : userToken?.uid) ||
      ""
    ).trim();

    if (clearAll === "true") {
      if (recipient === "admin" && !staffToken) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!staffToken && userToken && recipient !== userToken.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await storage.clearAllNotifications(recipient);
    } else if (id) {
      const notif = await storage.getNotificationById(id);
      if (!notif) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
      const ownerRecipient = String(notif.recipient || "");
      const canDelete =
        ownerRecipient === "admin"
          ? Boolean(staffToken)
          : Boolean(staffToken || (userToken && userToken.uid === ownerRecipient));

      if (!canDelete) {
        await logSecurityEvent({
          action: "notifications.delete_idor_attempt",
          severity: "high",
          actorUid: userToken?.uid || null,
          ip,
          targetType: "notification",
          targetId: id,
          outcome: "denied",
          reason: "Unauthorized attempt to delete another user's/admin's notification",
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await storage.deleteNotification(id);
    } else {
      return NextResponse.json(
        { error: "Missing id or all=true param" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
