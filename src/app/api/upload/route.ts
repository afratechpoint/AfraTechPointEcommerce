import { verifyAdmin } from '@/lib/auth-server';
import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import path from 'path';

// ImageKit configuration (env overrides keep the key out of source when set).
const IMAGEKIT_PUBLIC_KEY  = process.env.IMAGEKIT_PUBLIC_KEY || "public_q6EAh8AgOv6qeEBIe6xLUlWF2XI=";
const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || "private_/bOCaYv2iR0Z83fl32njT2mo+B4=";
const IMAGEKIT_ENDPOINT    = process.env.IMAGEKIT_ENDPOINT || "https://ik.imagekit.io/afratechpoint";
const MAX_FILE_BYTES       = 10 * 1024 * 1024; // ImageKit per-file limit

const getImageKitAuthHeader = () => 'Basic ' + Buffer.from(IMAGEKIT_PRIVATE_KEY + ':').toString('base64');

function safeFileName(name: string) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "image"}${ext}`;
}

function errorMessage(error: any): string {
  return error?.message || error?.error?.message || error?.error || "Upload failed";
}

export async function GET(request: NextRequest) {
  try {
    const adminToken = await verifyAdmin(request);
    if (!adminToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const sync = searchParams.get('sync') === 'true';

    if (sync) {
      await storage.syncMediaWithImageKit({
        publicKey: IMAGEKIT_PUBLIC_KEY,
        privateKey: IMAGEKIT_PRIVATE_KEY,
        endpoint: IMAGEKIT_ENDPOINT
      });
    }

    const media = await storage.getMedia();
    return NextResponse.json(media || []);
  } catch (error: any) {
    return NextResponse.json({ error: errorMessage(error) || 'Failed to list files' }, { status: 500 });
  }
}

// POST: Upload one or more files to ImageKit.io
export async function POST(request: NextRequest) {
  try {
    const adminToken = await verifyAdmin(request);
    if (!adminToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploaded: { name: string; url: string }[] = [];
    const failed: { name: string; error: string }[] = [];

    // Each file is handled independently: one bad file no longer aborts the
    // whole batch, and the client gets the real reason for each failure.
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. ImageKit allows up to 10 MB per file.`);
        }

        const contentType = file.type || 'application/octet-stream';
        if (!contentType.startsWith('image/')) {
          throw new Error(`"${file.name}" is not a supported image file.`);
        }

        const fileName = safeFileName(file.name);
        const buffer = Buffer.from(await file.arrayBuffer());

        const ikFormData = new FormData();
        // Preserve the MIME type — omitting it makes ImageKit reject some formats.
        ikFormData.append('file', new Blob([buffer], { type: contentType }), fileName);
        ikFormData.append('fileName', fileName);
        ikFormData.append('useUniqueFileName', 'true');
        ikFormData.append('folder', '/products');

        const ikResponse = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
          method: 'POST',
          headers: { 'Authorization': getImageKitAuthHeader() },
          body: ikFormData,
        });

        let ikData: any = {};
        try { ikData = await ikResponse.json(); } catch { /* non-JSON error */ }

        if (!ikResponse.ok) {
          throw new Error(ikData?.message || ikData?.error?.message || `ImageKit rejected the file (HTTP ${ikResponse.status}).`);
        }
        if (!ikData.url) {
          throw new Error('ImageKit did not return a file URL.');
        }

        await storage.saveMedia({
          name: ikData.name || fileName,
          url: ikData.url,
          size: file.size,
          deleteUrl: ikData.fileId,
          imgbbId: '',
          uploadedAt: new Date().toISOString()
        });

        uploaded.push({ name: ikData.name || fileName, url: ikData.url });
      } catch (error: any) {
        console.error(`[Upload] Failed for "${file.name}":`, error);
        failed.push({ name: file.name, error: errorMessage(error) });
      }
    }

    return NextResponse.json(
      { success: failed.length === 0, files: uploaded, failed },
      { status: failed.length === files.length ? 400 : 200 }
    );
  } catch (error: any) {
    console.error('Master Upload error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

// DELETE: Remove from ImageKit & sync
export async function DELETE(request: NextRequest) {
  try {
    const adminToken = await verifyAdmin(request);
    if (!adminToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filename } = await request.json();
    if (!filename) return NextResponse.json({ error: 'No filename provided' }, { status: 400 });

    const mediaList = await storage.getMedia();
    const mediaItem = mediaList.find((m: any) => m.name === filename);

    if (mediaItem) {
      // 1. ImageKit file (deleteUrl stores the fileId)
      if (mediaItem.deleteUrl && !mediaItem.deleteUrl.startsWith('media/')) {
        try {
          await fetch(`https://api.imagekit.io/v1/files/${mediaItem.deleteUrl}`, {
            method: 'DELETE',
            headers: { 'Authorization': getImageKitAuthHeader() },
          });
        } catch (e) {
          console.warn(`[ImageKit] Deletion failed for ${mediaItem.deleteUrl}`, e);
        }
      }

      // 2. Legacy ImgBB deletion
      if (mediaItem.imgbbId && process.env.IMGBB_API_KEY) {
        try {
          await fetch(`https://api.imgbb.com/1/delete?key=${process.env.IMGBB_API_KEY}&id=${mediaItem.imgbbId}`, { method: 'POST' }).catch(() => {});
        } catch (e) {}
      }
    }

    await storage.deleteMedia(filename);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Master Delete error:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
