import { verifyAdmin, verifyCatalogStaff } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { detectSafeImageMagicBytes } from "@/lib/security/file-validation";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, logSecurityEvent } from "@/lib/security/audit-log";
import path from "path";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES_PER_REQUEST = 10;

function getImageKitConfig() {
  const publicKey = (process.env.IMAGEKIT_PUBLIC_KEY || "").trim();
  const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
  const endpoint = (
    process.env.IMAGEKIT_ENDPOINT || "https://ik.imagekit.io/afratechpoint"
  ).trim();
  return { publicKey, privateKey, endpoint };
}

function safeBaseFileName(name: string, verifiedExt: string) {
  const rawExt = path.extname(name);
  const base = path
    .basename(name, rawExt)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "image"}${verifiedExt}`;
}

export async function GET(request: NextRequest) {
  try {
    const staffCaller = await verifyCatalogStaff(request);
    if (!staffCaller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const sync = searchParams.get("sync") === "true";

    if (sync) {
      const adminOnly = await verifyAdmin(request);
      if (!adminOnly) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const cfg = getImageKitConfig();
      if (!cfg.privateKey) {
        return NextResponse.json(
          { error: "ImageKit credentials are not configured on the server." },
          { status: 503 }
        );
      }
      await storage.syncMediaWithImageKit(cfg);
    }

    const media = await storage.getMedia();
    return NextResponse.json(media || []);
  } catch (error: any) {
    console.error("[Upload GET] Error:", error?.message);
    return NextResponse.json({ error: "Failed to list media files" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const staffCaller = await verifyCatalogStaff(request, { checkRevoked: true });
    if (!staffCaller) {
      await logSecurityEvent({
        action: "media.upload",
        severity: "high",
        ip,
        outcome: "denied",
        reason: "Unauthorized file upload attempt",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkRateLimit({
      bucket: "media_upload",
      identifier: staffCaller.uid,
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Upload rate limit exceeded. Please wait before uploading more files." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { privateKey } = getImageKitConfig();
    if (!privateKey) {
      return NextResponse.json(
        { error: "Media upload service is not configured (missing IMAGEKIT_PRIVATE_KEY)." },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((f): f is File => typeof f !== "string" && f.size > 0);

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES_PER_REQUEST} files allowed per upload.` },
        { status: 400 }
      );
    }

    const authHeader = "Basic " + Buffer.from(privateKey + ":").toString("base64");
    const uploaded: { name: string; url: string }[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error("File exceeds the 10 MB maximum size limit.");
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Inspect actual binary magic bytes — blocks SVG/HTML/XML/script spoofing
        const verifiedImage = detectSafeImageMagicBytes(buffer);
        if (!verifiedImage) {
          await logSecurityEvent({
            action: "media.unsafe_file_rejected",
            severity: "high",
            actorUid: staffCaller.uid,
            actorEmail: staffCaller.email || null,
            ip,
            outcome: "denied",
            reason: "Rejected upload failing binary raster magic-byte check (e.g. SVG/HTML/spoof)",
            metadata: { originalName: file.name, declaredType: file.type },
          });
          throw new Error(
            "Unsupported or unsafe file format. Only JPEG, PNG, WebP, GIF, and AVIF images are allowed."
          );
        }

        const fileName = safeBaseFileName(file.name, verifiedImage.extension);
        const ikFormData = new FormData();
        const uint8 = new Uint8Array(buffer);
        ikFormData.append(
          "file",
          new Blob([uint8], { type: verifiedImage.mimeType }),
          fileName
        );
        ikFormData.append("fileName", fileName);
        ikFormData.append("useUniqueFileName", "true");
        ikFormData.append("folder", "/products");

        const ikResponse = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
          method: "POST",
          headers: { Authorization: authHeader },
          body: ikFormData,
          signal: AbortSignal.timeout(25000),
        });

        let ikData: any = {};
        try {
          ikData = await ikResponse.json();
        } catch {}

        if (!ikResponse.ok || !ikData.url) {
          throw new Error("Upstream media storage rejected the image.");
        }

        await storage.saveMedia({
          name: ikData.name || fileName,
          url: ikData.url,
          size: file.size,
          deleteUrl: ikData.fileId,
          imgbbId: "",
          uploadedAt: new Date().toISOString(),
        });

        uploaded.push({ name: ikData.name || fileName, url: ikData.url });
      } catch (error: any) {
        failed.push({
          name: String(file.name || "file").slice(0, 80),
          error: error?.message || "Upload failed",
        });
      }
    }

    if (uploaded.length > 0) {
      await logSecurityEvent({
        action: "media.uploaded",
        severity: "info",
        actorUid: staffCaller.uid,
        actorEmail: staffCaller.email || null,
        actorRole: staffCaller.resolvedRole,
        ip,
        outcome: "allowed",
        metadata: { count: uploaded.length },
      });
    }

    return NextResponse.json(
      { success: failed.length === 0, files: uploaded, failed },
      { status: failed.length === files.length ? 400 : 200 }
    );
  } catch (error: any) {
    console.error("[Upload POST] Error:", error?.message);
    return NextResponse.json({ error: "Upload processing failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const adminToken = await verifyAdmin(request, { checkRevoked: true });
    if (!adminToken) {
      await logSecurityEvent({
        action: "media.delete",
        severity: "high",
        ip,
        outcome: "denied",
        reason: "Unauthorized media deletion attempt",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    if (!filename || filename.length > 200) {
      return NextResponse.json({ error: "Valid filename is required" }, { status: 400 });
    }

    const mediaList = await storage.getMedia();
    const mediaItem = mediaList.find((m: any) => m.name === filename);
    const { privateKey } = getImageKitConfig();

    if (mediaItem) {
      if (
        privateKey &&
        mediaItem.deleteUrl &&
        !String(mediaItem.deleteUrl).startsWith("media/") &&
        /^[A-Za-z0-9_-]{4,128}$/.test(String(mediaItem.deleteUrl))
      ) {
        try {
          const authHeader = "Basic " + Buffer.from(privateKey + ":").toString("base64");
          await fetch(
            `https://api.imagekit.io/v1/files/${encodeURIComponent(String(mediaItem.deleteUrl))}`,
            {
              method: "DELETE",
              headers: { Authorization: authHeader },
              signal: AbortSignal.timeout(10000),
            }
          );
        } catch {}
      }

      if (
        mediaItem.imgbbId &&
        process.env.IMGBB_API_KEY &&
        /^[A-Za-z0-9_-]{4,64}$/.test(String(mediaItem.imgbbId))
      ) {
        try {
          const form = new URLSearchParams({
            key: process.env.IMGBB_API_KEY,
            id: String(mediaItem.imgbbId),
          });
          await fetch("https://api.imgbb.com/1/delete", {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(10000),
          }).catch(() => {});
        } catch {}
      }
    }

    await storage.deleteMedia(filename);

    await logSecurityEvent({
      action: "media.deleted",
      severity: "info",
      actorUid: adminToken.uid,
      actorEmail: adminToken.email || null,
      actorRole: "admin",
      ip,
      targetType: "media",
      targetId: filename,
      outcome: "allowed",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Upload DELETE] Error:", error?.message);
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
  }
}
