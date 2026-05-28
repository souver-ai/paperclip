CREATE TABLE IF NOT EXISTS "quota_governor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"snapshot_date" text NOT NULL,
	"quota_window_key" text NOT NULL,
	"quota_source" text NOT NULL,
	"quota_window" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"window_start_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"usage_cents" integer DEFAULT 0 NOT NULL,
	"quota_limit_cents" integer,
	"provider_used_percent" double precision,
	"projected_usage_percent" double precision,
	"decision" text NOT NULL,
	"forecast" jsonb NOT NULL,
	"cadence_snapshot" jsonb NOT NULL,
	"cadence_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quota_governor_snapshots_company_id_companies_id_fk') THEN
		ALTER TABLE "quota_governor_snapshots" ADD CONSTRAINT "quota_governor_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_governor_snapshots_company_created_idx" ON "quota_governor_snapshots" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quota_governor_snapshots_company_date_window_uq" ON "quota_governor_snapshots" USING btree ("company_id","snapshot_date","quota_window_key");
