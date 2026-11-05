import { requireAuth } from "@/lib/auth";
import {
  NotFoundError,
  type OutgoingContent,
  getContact,
  listMessages,
  sendMessage,
} from "@/lib/chat";
import { MAX_FILE_BYTES, isOurUploadUrl } from "@/lib/media";

/** LINE's limit for a single text message. */
const MAX_TEXT_LENGTH = 5000;

/** Conversation with one LINE user. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/contacts/[userId]/messages">,
) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { userId } = await ctx.params;
  const contact = await getContact(userId);
  if (!contact) {
    return Response.json({ error: "Unknown LINE user" }, { status: 404 });
  }
  return Response.json({ contact, messages: await listMessages(userId) });
}

/** Reply to a LINE user. Body: { "text": "..." } */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/contacts/[userId]/messages">,
) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { userId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseContent(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const message = await sendMessage(userId, parsed.content);
    // A failed push is still saved (shown with an error in the UI), so it's a 502, not a 500.
    return Response.json({ message }, { status: message.status === "failed" ? 502 : 201 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

/**
 * Body: { text } (type defaults to "text"),
 *       { type: "image", url, previewUrl },
 *    or { type: "file", url, fileName, fileSize }.
 * Media URLs must point into our own Blob store (see lib/media.ts).
 */
function parseContent(
  body: Record<string, unknown> | null,
): { content: OutgoingContent } | { error: string } {
  const type = body?.type ?? "text";

  if (type === "text") {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return { error: "Message is empty" };
    if (text.length > MAX_TEXT_LENGTH) {
      return { error: `Message is longer than ${MAX_TEXT_LENGTH} characters` };
    }
    return { content: { type: "text", text } };
  }

  if (type === "image") {
    if (!isOurUploadUrl(body?.url) || !isOurUploadUrl(body?.previewUrl)) {
      return { error: "Image must be uploaded through /api/uploads" };
    }
    return { content: { type: "image", url: body.url, previewUrl: body.previewUrl } };
  }

  if (type === "file") {
    const fileName = typeof body?.fileName === "string" ? body.fileName.trim().slice(0, 200) : "";
    const fileSize = body?.fileSize;
    if (!isOurUploadUrl(body?.url)) return { error: "File must be uploaded through /api/uploads" };
    if (!fileName) return { error: "File name is missing" };
    if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 0 || fileSize > MAX_FILE_BYTES) {
      return { error: "Invalid file size" };
    }
    return { content: { type: "file", url: body.url, fileName, fileSize } };
  }

  return { error: "Unsupported message type" };
}
