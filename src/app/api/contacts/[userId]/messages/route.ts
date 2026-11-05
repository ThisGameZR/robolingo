import { NotFoundError, getContact, listMessages, sendText } from "@/lib/chat";

/** LINE's limit for a single text message. */
const MAX_TEXT_LENGTH = 5000;

/** Conversation with one LINE user. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/contacts/[userId]/messages">,
) {
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
  const { userId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Message is empty" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json(
      { error: `Message is longer than ${MAX_TEXT_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const message = await sendText(userId, text);
    // A failed push is still saved (shown with an error in the UI), so it's a 502, not a 500.
    return Response.json({ message }, { status: message.status === "failed" ? 502 : 201 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
