import { listContacts } from "@/lib/chat";

/** All LINE users who have talked to the OA, most recent conversation first. */
export async function GET() {
  return Response.json({ contacts: await listContacts() });
}
