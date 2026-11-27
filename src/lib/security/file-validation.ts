export interface ValidatedImageInfo {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";
  extension: ".jpg" | ".png" | ".webp" | ".gif" | ".avif";
}

/**
 * Inspects binary magic bytes of an uploaded file buffer rather than trusting
 * client-supplied file extensions or `Content-Type` headers.
 * Explicitly blocks SVG (`image/svg+xml`), HTML, XML, PDF, and executable content
 * to prevent Stored XSS and MIME-spoofing attacks.
 */
export function detectSafeImageMagicBytes(buffer: Buffer): ValidatedImageInfo | null {
  if (!buffer || buffer.length < 12) return null;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }

  // 2. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }

  // 3. GIF: "GIF87a" or "GIF89a"
  const head6 = buffer.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") {
    return { mimeType: "image/gif", extension: ".gif" };
  }

  // 4. WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: ".webp" };
  }

  // 5. AVIF: ISO Base Media File Format `....ftypavif` or `....ftypavis`
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") {
      return { mimeType: "image/avif", extension: ".avif" };
    }
  }

  return null;
}
