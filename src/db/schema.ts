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
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastMessagePreview: text("last_message_preview"),
  profileFetchedAt: timestamp("profile_fetched_at", { withTimezone: true }),
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
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_user_created_idx").on(t.userId, t.createdAt)],
);

export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
