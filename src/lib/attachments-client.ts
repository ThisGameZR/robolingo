"use client";

import { upload } from "@vercel/blob/client";

/** Browser-side helpers for attachments. Server-side rules live in lib/media.ts. */

const MAX_IMAGE_SIDE = 2048;
const PREVIEW_SIDE = 240;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FILE_ACCEPT =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";

/** Images LINE can show inline. Anything else is sent as a file link. */
export function isImage(file: File) {
  return /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type);
}

async function toJpeg(bitmap: ImageBitmap, maxSide: number, maxBytes: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error("Image is too large even after compression");
}

/**
 * LINE needs a JPEG/PNG original (≤ 10 MB) and a small preview (≤ 1 MB).
 * Re-encoding through a canvas also strips EXIF metadata such as GPS location.
 */
export async function prepareImage(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image format isn't supported by your browser (try JPEG or PNG)");
  }
  try {
    const [original, preview] = await Promise.all([
      toJpeg(bitmap, MAX_IMAGE_SIDE, MAX_IMAGE_BYTES),
      toJpeg(bitmap, PREVIEW_SIDE, MAX_PREVIEW_BYTES),
    ]);
    return { original, preview };
  } finally {
    bitmap.close();
  }
}

/** Safe, readable object name. The server adds a random suffix. */
export function safeName(name: string, fallbackExt = "") {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  const ext = (dot > 0 ? name.slice(dot) : fallbackExt).toLowerCase().replace(/[^.\w]/g, "");
  return `${base}${ext}`;
}

/** Uploads straight from the browser to Vercel Blob (not through our functions). */
export async function uploadToBlob(
  name: string,
  body: Blob,
  kind: "image" | "preview" | "file",
  contentType: string,
  onProgress?: (percent: number) => void,
) {
  const result = await upload(`uploads/${name}`, body, {
    access: "public",
    handleUploadUrl: "/api/uploads",
    clientPayload: JSON.stringify({ kind }),
    contentType,
    multipart: body.size > 8 * 1024 * 1024,
    onUploadProgress: onProgress ? ({ percentage }) => onProgress(percentage) : undefined,
  });
  return result.url;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
