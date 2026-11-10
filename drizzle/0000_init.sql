CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"bank" text DEFAULT '' NOT NULL,
	"bank_domain" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"school" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_confidence" integer DEFAULT 0 NOT NULL,
	"info_confidence" integer DEFAULT 0 NOT NULL,
	"email_source" text DEFAULT 'ai' NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text DEFAULT 'initial' NOT NULL,
	"parent_email_id" uuid,
	"to_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"attach_resume" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"rfc_message_id" text,
	"error" text,
	"bounced_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery_status" text DEFAULT 'unknown' NOT NULL,
	"replied_at" timestamp with time zone,
	"reply_snippet" text,
	"grammar" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"refresh_token_enc" text,
	"profile" jsonb DEFAULT '{"fullName":"","school":"","gradYear":"","major":"","hometown":"","pastExperience":"","interests":"","signature":"","targeting":"","resumeText":""}'::jsonb NOT NULL,
	"rules" jsonb,
	"rules_chat" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_pdf_b64" text,
	"resume_filename" text,
	"hunter_key_enc" text,
	"apollo_key_enc" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "emails_user_status_idx" ON "emails" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "emails_contact_idx" ON "emails" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "emails_due_idx" ON "emails" USING btree ("status","scheduled_at");