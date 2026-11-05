import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { UPLOAD_RULES, isUploadKind } from "@/lib/media";

/**
 * Issues short-lived tokens so the browser uploads attachments straight to
 * Vercel Blob. Files never pass through this function, which matters because
 * Vercel functions accept at most 4.5 MB per request but LINE allows 10 MB images.
 */
export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const token = env().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Attachments are not configured (BLOB_READ_WRITE_TOKEN is missing)." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || body.type !== "blob.generate-client-token") {
    // We don't register an upload-completed callback, so only token requests are valid.
    return Response.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const kind = parseKind(clientPayload);
        if (!kind) throw new Error("Unknown upload kind");
        if (!pathname.startsWith("uploads/") || pathname.includes("..")) {
          throw new Error("Invalid upload path");
        }
        const rules = UPLOAD_RULES[kind];
        return {
          allowedContentTypes: rules.types,
          maximumSizeInBytes: rules.maxBytes,
          // Unguessable URLs: a random suffix is appended to every name.
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload not allowed" },
      { status: 400 },
    );
  }
}

function parseKind(clientPayload: string | null) {
  try {
    const kind = (JSON.parse(clientPayload ?? "{}") as { kind?: unknown }).kind;
    return isUploadKind(kind) ? kind : null;
  } catch {
    return null;
  }
}
