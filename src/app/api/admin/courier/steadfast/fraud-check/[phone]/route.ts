import { NextRequest, NextResponse } from "next/server";
import { verifyOrderStaff } from "@/lib/auth-server";
import { steadfast } from "@/lib/courier/steadfast";
import {
  getFraudCheckFromFirestore,
  saveFraudCheckInFirestore,
} from "@/lib/firebase/server_firestore";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const staffCaller = await verifyOrderStaff(request);
  if (!staffCaller) {
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const rl = await checkRateLimit({
    bucket: "steadfast_fraud_check",
    identifier: staffCaller.uid,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many fraud checks. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const { phone: rawPhone } = await params;
    const phone = String(rawPhone || "").replace(/\D/g, "").slice(-11);

    if (!/^01\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: "A valid 11-digit Bangladesh mobile number is required." },
        { status: 400 }
      );
    }

    const cached = await getFraudCheckFromFirestore(phone);
    const CACHE_HOURS = 48;
    const now = new Date();

    if (
      cached &&
      now.getTime() - cached.lastChecked.getTime() < CACHE_HOURS * 60 * 60 * 1000
    ) {
      return NextResponse.json({
        success: true,
        isCached: true,
        lastChecked: cached.lastChecked,
        data: cached.data,
      });
    }

    const result = await steadfast.checkFraud(phone);

    if (
      result.status === 200 ||
      typeof result.total_parcels !== "undefined" ||
      typeof result.total_parcel !== "undefined"
    ) {
      const total = Number(result.total_parcels ?? result.total_parcel ?? 0);
      const delivered = Number(
        result.total_delivered ?? result.delivered_parcel ?? result.success_parcel ?? 0
      );
      const cancelled = Number(result.total_cancelled ?? result.cancelled_parcel ?? 0);

      const rawReports = result.total_fraud_reports ?? result.fraud_report;
      const reports = Array.isArray(rawReports)
        ? rawReports.length
        : Number(rawReports) || 0;

      const fraudData = {
        totalParcels: total,
        delivered,
        cancelled,
        fraudReports: reports,
        successRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      };

      await saveFraudCheckInFirestore(phone, { data: fraudData });

      return NextResponse.json({
        success: true,
        isCached: false,
        data: fraudData,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve fraud history for this number.",
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[Steadfast Fraud Check API] Error:", error?.message);
    return NextResponse.json(
      { error: "Courier fraud-check service unavailable." },
      { status: 500 }
    );
  }
}
