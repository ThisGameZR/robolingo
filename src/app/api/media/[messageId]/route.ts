import { fetchMessageContent } from "@/lib/line";

/**
 * Streams an image/video/audio/file a LINE user sent, so the webchat can show it.
 * LINE needs the channel access token to download it, so the browser can't fetch it directly.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/media/[messageId]">,
) {
  const { messageId } = await ctx.params;
  if (!/^\d+$/.test(messageId)) {
    return Response.json({ error: "Invalid message id" }, { status: 400 });
  }

  const upstream = await fetchMessageContent(messageId);
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Content not available" },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // Message content never changes; cache privately in the browser.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
