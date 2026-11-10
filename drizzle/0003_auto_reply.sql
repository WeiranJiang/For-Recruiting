ALTER TABLE "emails" ADD COLUMN "auto_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "auto_reply_snippet" text;