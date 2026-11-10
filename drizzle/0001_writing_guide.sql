ALTER TABLE "contacts" ADD COLUMN "my_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "ai_subject" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "ai_body" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "rationale" jsonb;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "learned_from_edit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "writing_guide" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "style_guidelines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "style_chat" jsonb DEFAULT '[]'::jsonb NOT NULL;