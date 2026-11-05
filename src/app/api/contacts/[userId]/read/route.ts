import { requireAuth } from "@/lib/auth";
import { markRead } from "@/lib/chat";

/** Clear the unread badge for a conversation. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/contacts/[userId]/read">,
) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { userId } = await ctx.params;
  await markRead(userId);
  return Response.json({ ok: true });
}
