ALTER TABLE "contacts" ADD COLUMN "mark_as_read_token" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "unsent_at" timestamp with time zone;