import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { verifyUser } from "@/lib/auth-server";
import { profileUpdateSchema } from "@/lib/security/validation";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";

export async function GET(request: NextRequest) {
  const caller = await verifyUser(request);
  if (!caller?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = await storage.getUserProfile(caller.uid);
    if (!profile) return NextResponse.json({});

    // Return safe profile DTO only
    return NextResponse.json({
      displayName: profile.displayName ?? "",
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      division: profile.division ?? "",
      district: profile.district ?? "",
      upazila: profile.upazila ?? "",
      bio: profile.bio ?? "",
      photoURL: profile.photoURL ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const caller = await verifyUser(request);

  if (!caller?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit({
    bucket: "profile_update",
    identifier: caller.uid,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many profile updates. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const rawBody = await request.json();
    const candidateData = rawBody?.data;

    if (!candidateData || typeof candidateData !== "object" || Array.isArray(candidateData)) {
      return NextResponse.json({ error: "Data is required" }, { status: 400 });
    }

    // Detect and log privilege-escalation / mass-assignment attempts (`role`, `isAdmin`, etc.)
    if ("role" in candidateData || "isAdmin" in candidateData || "uid" in candidateData) {
      await logSecurityEvent({
        action: "profile.privilege_escalation_attempt",
        severity: "critical",
        actorUid: caller.uid,
        actorEmail: caller.email || null,
        ip,
        targetType: "user",
        targetId: caller.uid,
        outcome: "denied",
        reason: "Customer attempted to modify restricted identity/role fields via /api/profile",
        metadata: { attemptedKeys: Object.keys(candidateData) },
      });
      return NextResponse.json(
        { error: "Forbidden fields in profile update request." },
        { status: 400 }
      );
    }

    const parsed = profileUpdateSchema.safeParse(candidateData);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid profile data." },
        { status: 400 }
      );
    }

    await storage.updateUserProfile(caller.uid, parsed.data);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
