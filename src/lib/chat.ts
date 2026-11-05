import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { webhook } from "@line/bot-sdk";
import { getDb, schema } from "@/db";
import { describeLineError, lineClient } from "./line";

const { contacts, messages } = schema;

/** Refresh a user's LINE profile at most once per this interval. */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reads used by the webchat
// ---------------------------------------------------------------------------

export async function listContacts() {
  const db = await getDb();
  return db
    .select()
    .from(contacts)
    .orderBy(
      sql`${contacts.lastMessageAt} desc nulls last`,
      desc(contacts.createdAt),
    );
}

export async function getContact(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
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

export async function sendText(userId: string, text: string) {
  const db = await getDb();
  const contact = await getContact(userId);
  if (!contact) throw new NotFoundError("Unknown LINE user");

  let status: "sent" | "failed" = "sent";
  let error: string | null = null;
  let lineMessageId: string | null = null;
  try {
    const res = await lineClient().pushMessage(
      { to: userId, messages: [{ type: "text", text }] },
      // Retry key: lets LINE de-duplicate if this request is retried.
      randomUUID(),
    );
    lineMessageId = res.sentMessages?.[0]?.id ?? null;
  } catch (err) {
    status = "failed";
    error = describeLineError(err);
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

// ---------------------------------------------------------------------------
// Webhook processing (LINE -> us)
// ---------------------------------------------------------------------------

export async function handleWebhookEvent(event: webhook.Event) {
  // Only 1:1 chats. Group/room messages are out of scope.
  if (event.source?.type !== "user" || !event.source.userId) return;
  const userId = event.source.userId;

  switch (event.type) {
    case "follow":
      await upsertContact(userId, { isFollowing: true, forceProfile: true });
      return;
    case "unfollow":
      await setFollowing(userId, false);
      return;
    case "message":
      await upsertContact(userId, { isFollowing: true });
      await saveIncomingMessage(userId, event);
      return;
    default:
      return;
  }
}

async function upsertContact(
  userId: string,
  opts: { isFollowing: boolean; forceProfile?: boolean },
) {
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
        isFollowing: opts.isFollowing,
        profileFetchedAt: profile ? new Date() : null,
      })
      .onConflictDoNothing();
    return;
  }

  await db
    .update(contacts)
    .set({
      isFollowing: opts.isFollowing,
      ...(profile && {
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl ?? null,
        statusMessage: profile.statusMessage ?? null,
        language: profile.language ?? null,
        profileFetchedAt: new Date(),
      }),
    })
    .where(eq(contacts.userId, userId));
}

async function setFollowing(userId: string, isFollowing: boolean) {
  const db = await getDb();
  await db
    .update(contacts)
    .set({ isFollowing })
    .where(eq(contacts.userId, userId));
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

  // Don't move "last message" backwards if events arrive out of order.
  const isNewest = sql`(${contacts.lastMessageAt} is null or ${contacts.lastMessageAt} <= ${createdAt.toISOString()}::timestamptz)`;
  await db
    .update(contacts)
    .set({
      unreadCount: sql`${contacts.unreadCount} + 1`,
      lastMessageAt: sql`case when ${isNewest} then ${createdAt.toISOString()}::timestamptz else ${contacts.lastMessageAt} end`,
      lastMessagePreview: sql`case when ${isNewest} then ${preview(m.type, text)} else ${contacts.lastMessagePreview} end`,
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
