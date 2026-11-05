import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, isNull, lte, or, sql } from "drizzle-orm";
import type { messagingApi, webhook } from "@line/bot-sdk";
import { getDb, schema } from "@/db";
import { describeLineError, lineClient, lineErrorStatus } from "./line";

const { contacts, messages } = schema;

/** Refresh a user's LINE profile at most once per this interval. */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reads used by the webchat
// ---------------------------------------------------------------------------

function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const key of keys) delete copy[key];
  return copy;
}

/** Contact fields safe to send to the browser (reply tokens stay server-side). */
const publicContactColumns = omit(getTableColumns(contacts), [
  "replyToken",
  "replyTokenReceivedAt",
]);

export async function listContacts() {
  const db = await getDb();
  return db
    .select(publicContactColumns)
    .from(contacts)
    .orderBy(
      sql`${contacts.lastMessageAt} desc nulls last`,
      desc(contacts.createdAt),
    );
}

export async function getContact(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select(publicContactColumns)
    .from(contacts)
    .where(eq(contacts.userId, userId));
  return row;
}

/** The most recent `limit` messages, oldest first. */
export async function listMessages(userId: string, limit = 200) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

export async function markRead(userId: string) {
  const db = await getDb();
  await db
    .update(contacts)
    .set({ unreadCount: 0 })
    .where(eq(contacts.userId, userId));
}

// ---------------------------------------------------------------------------
// Sending from the webchat
// ---------------------------------------------------------------------------

/**
 * LINE documents reply tokens as valid for one minute after the webhook is
 * received, and warns not to rely on the exact limit. Leave a safety margin.
 */
const REPLY_TOKEN_TTL_SECONDS = 50;

/** LINE stops honouring reply tokens 20 minutes after the event, even on redelivery. */
const REPLY_TOKEN_MAX_EVENT_AGE_MS = 20 * 60 * 1000;

/**
 * Sends a text to a LINE user.
 *
 * Uses the free Reply API when the user wrote within the last ~50 seconds,
 * otherwise the Push API (counts toward the monthly message quota).
 */
export async function sendText(userId: string, text: string) {
  const db = await getDb();
  const contact = await getContact(userId);
  if (!contact) throw new NotFoundError("Unknown LINE user");

  const lineMessages: messagingApi.Message[] = [{ type: "text", text }];
  let status: "sent" | "failed" = "sent";
  let delivery: "reply" | "push" | null = null;
  let error: string | null = null;
  let lineMessageId: string | null = null;

  const replyToken = await claimReplyToken(userId);
  if (replyToken) {
    try {
      const res = await lineClient().replyMessage({ replyToken, messages: lineMessages });
      lineMessageId = res.sentMessages?.[0]?.id ?? null;
      delivery = "reply";
    } catch (err) {
      // 400 = token expired or already used: nothing was delivered, so Push is safe.
      // Anything else (timeout, 5xx) might have been delivered; don't risk sending twice.
      if (lineErrorStatus(err) !== 400) {
        status = "failed";
        error = describeLineError(err);
      }
    }
  }

  if (status === "sent" && !delivery) {
    try {
      const res = await lineClient().pushMessage(
        { to: userId, messages: lineMessages },
        // Retry key: LINE de-duplicates if this exact request is retried.
        randomUUID(),
      );
      lineMessageId = res.sentMessages?.[0]?.id ?? null;
      delivery = "push";
    } catch (err) {
      status = "failed";
      error = describeLineError(err);
    }
  }

  const [saved] = await db
    .insert(messages)
    .values({
      userId,
      direction: "out",
      type: "text",
      text,
      lineMessageId,
      status,
      delivery,
      error,
    })
    .returning();

  if (status === "sent") {
    await db
      .update(contacts)
      .set({
        lastMessageAt: saved.createdAt,
        lastMessagePreview: `You: ${preview("text", text)}`,
      })
      .where(eq(contacts.userId, userId));
  }
  return saved;
}

export class NotFoundError extends Error {}

/**
 * Atomically takes the user's reply token if it's still fresh, and clears it so
 * two operators replying at once can't both use it (tokens are single-use).
 */
async function claimReplyToken(userId: string): Promise<string | null> {
  const db = await getDb();
  const res = await db.execute<{ reply_token: string }>(sql`
    with claimed as (
      select ${contacts.userId}, ${contacts.replyToken}
      from ${contacts}
      where ${contacts.userId} = ${userId}
        and ${contacts.replyToken} is not null
        and ${contacts.replyTokenReceivedAt} > now() - make_interval(secs => ${REPLY_TOKEN_TTL_SECONDS})
      for update
    )
    update ${contacts}
    set reply_token = null, reply_token_received_at = null
    from claimed
    where ${contacts.userId} = claimed.user_id
    returning claimed.reply_token
  `);
  return res.rows[0]?.reply_token ?? null;
}

// ---------------------------------------------------------------------------
// Webhook processing (LINE -> us)
// ---------------------------------------------------------------------------

export async function handleWebhookEvent(event: webhook.Event) {
  // Only 1:1 chats. Group/room messages are out of scope.
  if (event.source?.type !== "user" || !event.source.userId) return;
  const userId = event.source.userId;

  const at = new Date(event.timestamp);

  switch (event.type) {
    case "follow":
      await upsertContact(userId, { forceProfile: true });
      await setFollowing(userId, true, at);
      return;
    case "unfollow":
      await setFollowing(userId, false, at);
      return;
    case "message":
      await upsertContact(userId);
      await saveIncomingMessage(userId, event);
      return;
    default:
      return;
  }
}

async function upsertContact(userId: string, opts: { forceProfile?: boolean } = {}) {
  const db = await getDb();
  const existing = await getContact(userId);

  const stale =
    !existing?.profileFetchedAt ||
    Date.now() - existing.profileFetchedAt.getTime() > PROFILE_TTL_MS;

  let profile:
    | { displayName: string; pictureUrl?: string; statusMessage?: string; language?: string }
    | undefined;
  if (opts.forceProfile || stale) {
    try {
      profile = await lineClient().getProfile(userId);
    } catch (err) {
      console.warn(`[line] getProfile(${userId}) failed:`, describeLineError(err));
    }
  }

  if (!existing) {
    await db
      .insert(contacts)
      .values({
        userId,
        displayName: profile?.displayName ?? `LINE user …${userId.slice(-6)}`,
        pictureUrl: profile?.pictureUrl ?? null,
        statusMessage: profile?.statusMessage ?? null,
        language: profile?.language ?? null,
        profileFetchedAt: profile ? new Date() : null,
      })
      .onConflictDoNothing();
    return;
  }

  if (!profile) return;
  await db
    .update(contacts)
    .set({
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl ?? null,
      statusMessage: profile.statusMessage ?? null,
      language: profile.language ?? null,
      profileFetchedAt: new Date(),
    })
    .where(eq(contacts.userId, userId));
}

/**
 * Applies a follow/unfollow only if it's newer than the last one applied,
 * so a redelivered old "follow" can't undo a later "unfollow".
 */
async function setFollowing(userId: string, isFollowing: boolean, at: Date) {
  const db = await getDb();
  await db
    .update(contacts)
    .set({ isFollowing, followChangedAt: at })
    .where(
      and(
        eq(contacts.userId, userId),
        or(isNull(contacts.followChangedAt), lte(contacts.followChangedAt, at)),
      ),
    );
}

async function saveIncomingMessage(userId: string, event: webhook.MessageEvent) {
  const db = await getDb();
  const m = event.message;
  const createdAt = new Date(event.timestamp);

  let text: string | null = null;
  let stickerPackageId: string | null = null;
  let stickerId: string | null = null;
  switch (m.type) {
    case "text":
      text = m.text;
      break;
    case "sticker":
      stickerPackageId = m.packageId;
      stickerId = m.stickerId;
      text = m.text ?? null;
      break;
    case "location":
      text = [m.title, m.address].filter(Boolean).join(" · ") ||
        `${m.latitude}, ${m.longitude}`;
      break;
    case "file":
      text = m.fileName;
      break;
  }

  const inserted = await db
    .insert(messages)
    .values({
      userId,
      direction: "in",
      type: m.type,
      text,
      lineMessageId: m.id,
      stickerPackageId,
      stickerId,
      status: "received",
      createdAt,
    })
    // LINE may redeliver the same webhook; the unique message id makes it a no-op.
    .onConflictDoNothing({ target: messages.lineMessageId })
    .returning({ id: messages.id });

  if (inserted.length === 0) return;

  // Keep the reply token from the newest message so the next reply can be free.
  const replyToken =
    event.replyToken && Date.now() - event.timestamp < REPLY_TOKEN_MAX_EVENT_AGE_MS
      ? event.replyToken
      : null;

  // Don't move "last message" (or the reply token) backwards if events arrive out of order.
  const isNewest = sql`(${contacts.lastMessageAt} is null or ${contacts.lastMessageAt} <= ${createdAt.toISOString()}::timestamptz)`;
  await db
    .update(contacts)
    .set({
      unreadCount: sql`${contacts.unreadCount} + 1`,
      lastMessageAt: sql`case when ${isNewest} then ${createdAt.toISOString()}::timestamptz else ${contacts.lastMessageAt} end`,
      lastMessagePreview: sql`case when ${isNewest} then ${preview(m.type, text)} else ${contacts.lastMessagePreview} end`,
      ...(replyToken && {
        replyToken: sql`case when ${isNewest} then ${replyToken} else ${contacts.replyToken} end`,
        replyTokenReceivedAt: sql`case when ${isNewest} then now() else ${contacts.replyTokenReceivedAt} end`,
      }),
    })
    .where(eq(contacts.userId, userId));
}

function preview(type: string, text: string | null): string {
  switch (type) {
    case "text":
      return (text ?? "").slice(0, 80);
    case "sticker":
      return "[Sticker]";
    case "image":
      return "[Image]";
    case "video":
      return "[Video]";
    case "audio":
      return "[Audio]";
    case "file":
      return `[File] ${text ?? ""}`.trim();
    case "location":
      return `[Location] ${text ?? ""}`.trim();
    default:
      return `[${type}]`;
  }
}
