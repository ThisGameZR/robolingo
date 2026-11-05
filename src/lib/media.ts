import { env } from "./env";

/**
 * Rules for attachments the operator sends. Shared by the upload-token route
 * (what may be uploaded) and the send route (what may be sent to LINE).
 */

/** LINE image messages: JPEG/PNG, original ≤ 10 MB, preview ≤ 1 MB, HTTPS URL ≤ 2000 chars. */
export const IMAGE_TYPES = ["image/jpeg", "image/png"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 1024 * 1024;
export const MAX_LINE_URL_LENGTH = 2000;

/**
 * LINE can't send files from an OA, so files go out as a download link.
 * Allow common documents only: no HTML/SVG/scripts that a public URL could serve.
 */
export const FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "image/jpeg",
  "image/png",
];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type UploadKind = "image" | "preview" | "file";

export const UPLOAD_RULES: Record<UploadKind, { types: string[]; maxBytes: number }> = {
  image: { types: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES },
  preview: { types: IMAGE_TYPES, maxBytes: MAX_PREVIEW_BYTES },
  file: { types: FILE_TYPES, maxBytes: MAX_FILE_BYTES },
};

export function isUploadKind(value: unknown): value is UploadKind {
  return value === "image" || value === "preview" || value === "file";
}

/** Public hostname of our Blob store, derived from the read-write token. */
export function blobStoreHost(): string | null {
  const token = env().BLOB_READ_WRITE_TOKEN;
  const storeId = token?.split("_")[3];
  return storeId ? `${storeId}.public.blob.vercel-storage.com`.toLowerCase() : null;
}

/**
 * Only URLs in *our* store, under uploads/, may be sent to LINE users, so the
 * send API can't be used to make the OA deliver arbitrary links or images.
 */
export function isOurUploadUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_LINE_URL_LENGTH) return false;
  const host = blobStoreHost();
  if (!host) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && url.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
