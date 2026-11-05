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
  // Events are handled in order; a failure doesn't stop the rest of the batch.
  let failed = 0;
  for (const event of payload.events ?? []) {
    try {
      await handleWebhookEvent(event);
    } catch (err) {
      failed++;
      console.error(
        JSON.stringify({
          msg: "webhook event failed",
          type: event.type,
          webhookEventId: event.webhookEventId,
          isRedelivery: event.deliveryContext?.isRedelivery,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // Non-2xx makes LINE redeliver the batch (when webhook redelivery is enabled).
  // That's safe: every handler is idempotent, so events that already succeeded
  // are no-ops the second time.
  if (failed > 0) {
    return Response.json({ ok: false, failed }, { status: 500 });
  }
  return Response.json({ ok: true });
}
