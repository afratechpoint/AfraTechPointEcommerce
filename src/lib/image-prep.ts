/**
 * Client-side image preparation before uploading to ImageKit.
 *
 * ImageKit rejects files above its per-file limit and some unusual formats.
 * Large photos are downscaled here so they upload reliably, and unsupported
 * files get a clear error instead of a generic "Upload failed".
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ImageKit per-file limit
const RESIZE_THRESHOLD = 8 * 1024 * 1024; // start downscaling before the hard limit
const MAX_DIMENSION = 2000;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This image format can't be read by the browser. Please use JPG, PNG or WebP."));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress the image."))),
      type,
      quality
    );
  });
}

/**
 * Returns a file that is safe to upload. Oversized images are downscaled;
 * everything else passes through unchanged.
 */
export async function prepareImageFile(original: File): Promise<File> {
  if (original.size <= RESIZE_THRESHOLD) return original;

  const img = await loadImage(await readAsDataURL(original));
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(img, 0, 0, width, height);

  // Keep PNG for transparency; otherwise JPEG is far smaller.
  const keepPng = original.type === "image/png";
  const type = keepPng ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, type, 0.85);
  const name = original.name.replace(/\.[^.]+$/, "") + (keepPng ? ".png" : ".jpg");

  return new File([blob], name, { type, lastModified: Date.now() });
}
