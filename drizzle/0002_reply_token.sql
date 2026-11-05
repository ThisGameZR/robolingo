ALTER TABLE "contacts" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "reply_token_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery" text;