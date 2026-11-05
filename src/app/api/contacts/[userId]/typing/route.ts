import { requireAuth } from "@/lib/auth";
import { showTyping } from "@/lib/chat";

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/** Shows the "..." typing animation in the LINE user's chat. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/contacts/[userId]/typing">,
) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { userId } = await ctx.params;
  if (!LINE_USER_ID.test(userId)) {
    return Response.json({ error: "Invalid LINE user id" }, { status: 400 });
  }
  await showTyping(userId);
  return new Response(null, { status: 204 });
}
