import { validateSignature, type webhook } from "@line/bot-sdk";
import { handleWebhookEvent } from "@/lib/chat";
import { channelSecret } from "@/lib/line";

/**
 * LINE Messaging API webhook.
 * Set this as the Webhook URL in LINE Developers Console:
 *   https://<your-app>.vercel.app/api/line/webhook
 */
export async function POST(request: Request) {
  const signature = request.headers.get("x-line-signature");
  const body = await request.text();

  if (!signature || !validateSignature(body, channelSecret(), signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: webhook.CallbackRequest;
  try {
    payload = JSON.parse(body) as webhook.CallbackRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The "Verify" button in LINE Developers Console sends an empty events array.
  for (const event of payload.events ?? []) {
    try {
      await handleWebhookEvent(event);
    } catch (err) {
      // Log and carry on: one bad event shouldn't make LINE retry the whole batch.
      console.error("[webhook] failed to handle event", event.type, err);
    }
  }

  return Response.json({ ok: true });
}
