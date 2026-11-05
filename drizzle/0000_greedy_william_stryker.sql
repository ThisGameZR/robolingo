CREATE TABLE "contacts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"picture_url" text,
	"status_message" text,
	"language" text,
	"is_following" boolean DEFAULT true NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"profile_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"line_message_id" text,
	"sticker_package_id" text,
	"sticker_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_line_message_id_unique" UNIQUE("line_message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_contacts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."contacts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_user_created_idx" ON "messages" USING btree ("user_id","created_at");