import crypto from "node:crypto";
import { HTTPFetchError, type webhook } from "@line/bot-sdk";
import { vi } from "vitest";
import { getDb, schema } from "@/db";
import { lineClient } from "@/lib/line";

export const USER = "U" + "a".repeat(32);
export const OTHER_USER = "U" + "b".repeat(32);

export async function resetDb() {
  const db = await getDb();
  await db.delete(schema.messages);
  await db.delete(schema.contacts);
  await db.delete(schema.rateLimits);
}

/** A webhook request signed the way LINE signs it. */
export function webhookRequest(events: unknown[], opts: { signature?: string } = {}) {
  const body = JSON.stringify({ destination: "Uoa", events });
  const signature =
    opts.signature ??
    crypto
      .createHmac("sha256", process.env.LINE_CHANNEL_SECRET!)
      .update(body)
      .digest("base64");
  return new Request("http://localhost/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body,
  });
}

let seq = 1000;

function base(userId: string, timestamp: number) {
  return {
    source: { type: "user" as const, userId },
    timestamp,
    mode: "active" as const,
    webhookEventId: crypto.randomUUID(),
    deliveryContext: { isRedelivery: false },
  };
}

export function textEvent(
  userId: string,
  text: string,
  opts: { id?: string; timestamp?: number; replyToken?: string; markAsReadToken?: string } = {},
): webhook.MessageEvent {
  return {
    ...base(userId, opts.timestamp ?? Date.now()),
    type: "message",
    replyToken: opts.replyToken ?? `reply-${seq}`,
    message: {
      type: "text",
      id: opts.id ?? String(seq++),
      text,
      quoteToken: "q",
      markAsReadToken: opts.markAsReadToken,
    },
  };
}

export function followEvent(userId: string, timestamp = Date.now()): webhook.FollowEvent {
  return {
    ...base(userId, timestamp),
    type: "follow",
    replyToken: "r",
    follow: { isUnblocked: false },
  };
}

export function unfollowEvent(userId: string, timestamp = Date.now()): webhook.UnfollowEvent {
  return { ...base(userId, timestamp), type: "unfollow" };
}

export function unsendEvent(userId: string, messageId: string): webhook.UnsendEvent {
  return { ...base(userId, Date.now()), type: "unsend", unsend: { messageId } };
}

export function lineHttpError(status: number, message: string) {
  return new HTTPFetchError(message, {
    status,
    statusText: String(status),
    headers: new Headers(),
    body: JSON.stringify({ message }),
  });
}

/** Replaces every LINE API call used by the app with a spy. */
export function mockLine() {
  const client = lineClient();
  return {
    getProfile: vi.spyOn(client, "getProfile").mockImplementation(async (userId: string) => ({
      userId,
      displayName: `Name of ${userId.slice(0, 5)}`,
      pictureUrl: "https://profile.line-scdn.net/p",
    })),
    pushMessage: vi
      .spyOn(client, "pushMessage")
      .mockResolvedValue({ sentMessages: [{ id: "push-1", quoteToken: "q" }] }),
    replyMessage: vi
      .spyOn(client, "replyMessage")
      .mockResolvedValue({ sentMessages: [{ id: "reply-1", quoteToken: "q" }] }),
    markMessagesAsReadByToken: vi
      .spyOn(client, "markMessagesAsReadByToken")
      .mockResolvedValue({}),
    showLoadingAnimation: vi.spyOn(client, "showLoadingAnimation").mockResolvedValue({}),
  };
}
