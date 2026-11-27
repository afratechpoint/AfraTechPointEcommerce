import { verifyAdmin } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";

const TOTAL_STORAGE_LIMIT_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

export async function GET(request: NextRequest) {
  try {
    const adminToken = await verifyAdmin(request);
    if (!adminToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
    if (!privateKey) {
      return NextResponse.json({
        usedBytes: 0,
        totalBytes: TOTAL_STORAGE_LIMIT_BYTES,
        availableBytes: TOTAL_STORAGE_LIMIT_BYTES,
        percentUsed: 0,
        configured: false,
      });
    }

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const authHeader = "Basic " + Buffer.from(privateKey + ":").toString("base64");

    const res = await fetch(
      `https://api.imagekit.io/v1/accounts/usage?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      throw new Error("Upstream usage request failed");
    }

    const data = await res.json();
    const usedBytes = Number(data.mediaLibraryStorageBytes) || 0;
    const availableBytes = Math.max(0, TOTAL_STORAGE_LIMIT_BYTES - usedBytes);

    return NextResponse.json({
      usedBytes,
      totalBytes: TOTAL_STORAGE_LIMIT_BYTES,
      availableBytes,
      percentUsed: (usedBytes / TOTAL_STORAGE_LIMIT_BYTES) * 100,
      configured: true,
    });
  } catch (error: any) {
    console.error("[Storage Usage API Error]", error?.message);
    return NextResponse.json({ error: "Failed to fetch storage usage" }, { status: 500 });
  }
}
