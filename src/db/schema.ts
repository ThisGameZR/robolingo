import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** A LINE user who has interacted with the Official Account. */
export const contacts = pgTable("contacts", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  pictureUrl: text("picture_url"),
  statusMessage: text("status_message"),
  language: text("language"),
  isFollowing: boolean("is_following").notNull().default(true),
  /** Timestamp of the follow/unfollow event that set isFollowing (guards against out-of-order redelivery). */
  followChangedAt: timestamp("follow_changed_at", { withTimezone: true }),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastMessagePreview: text("last_message_preview"),
  profileFetchedAt: timestamp("profile_fetched_at", { withTimezone: true }),
  /**
   * Latest unused reply token from this user's messages. Replying with it is free
   * (Push messages count toward the monthly quota), but it's single-use and only
   * valid for about a minute after the webhook arrives.
   */
  replyToken: text("reply_token"),
  replyTokenReceivedAt: timestamp("reply_token_received_at", { withTimezone: true }),
  /**
   * Read token from the newest message. Marking it as read also marks every
   * earlier message, so only the latest one is kept.
   */
  markAsReadToken: text("mark_as_read_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One chat message.
 * direction "in"  = LINE user -> OA (arrived via webhook)
 * direction "out" = webchat -> LINE user (sent with the Push API)
 */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => contacts.userId, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    /** LINE message type: text, sticker, image, video, audio, file, location */
    type: text("type").notNull(),
    text: text("text"),
    /** LINE message id. Unique, so webhook redeliveries are ignored. */
    lineMessageId: text("line_message_id").unique(),
    stickerPackageId: text("sticker_package_id"),
    stickerId: text("sticker_id"),
    status: text("status", { enum: ["received", "sent", "failed"] }).notNull(),
    /** Outgoing only: which LINE API delivered it. "reply" is free, "push" uses quota. */
    delivery: text("delivery", { enum: ["reply", "push"] }),
    error: text("error"),
    /** Set when the LINE user unsends the message; its content is then cleared. */
    unsentAt: timestamp("unsent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_user_created_idx").on(t.userId, t.createdAt)],
);

/** Fixed-window counters (e.g. login attempts per IP). Shared across serverless instances. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
