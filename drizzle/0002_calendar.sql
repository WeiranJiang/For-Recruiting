ALTER TABLE "users" ALTER COLUMN "profile" SET DEFAULT '{"fullName":"","school":"","gradYear":"","major":"","hometown":"","pastExperience":"","interests":"","signature":"","phone":"","targeting":"","resumeText":""}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_scopes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "availability" jsonb;