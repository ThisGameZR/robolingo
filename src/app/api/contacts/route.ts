import { requireAuth } from "@/lib/auth";
import { listContacts } from "@/lib/chat";

/** All LINE users who have talked to the OA, most recent conversation first. */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  return Response.json({ contacts: await listContacts() });
}
