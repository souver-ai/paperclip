CREATE TABLE IF NOT EXISTS "features" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "feature_id" text NOT NULL,
  "title" text NOT NULL,
  "source_team" text DEFAULT 'ops' NOT NULL,
  "intake_status" text DEFAULT 'proposed' NOT NULL,
  "priority_rank" integer,
  "pm_brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "why_now" text,
  "impact_estimate" text,
  "effort_estimate" text,
  "risk_level" text DEFAULT 'medium' NOT NULL,
  "product_area" text DEFAULT 'paperclip' NOT NULL,
  "repo" text,
  "root_issue_id" uuid,
  "delivery_state" text DEFAULT 'intake' NOT NULL,
  "required_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "terminal_evidence" jsonb,
  "next_action" text,
  "owner_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_priority_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "feature_id" uuid NOT NULL,
  "from_rank" integer,
  "to_rank" integer,
  "changed_by" text,
  "reason" text,
  "previous_intake_status" text,
  "new_intake_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'features_company_id_companies_id_fk') THEN
    ALTER TABLE "features" ADD CONSTRAINT "features_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'features_root_issue_id_issues_id_fk') THEN
    ALTER TABLE "features" ADD CONSTRAINT "features_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'features_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "features" ADD CONSTRAINT "features_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_priority_events_company_id_companies_id_fk') THEN
    ALTER TABLE "feature_priority_events" ADD CONSTRAINT "feature_priority_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_priority_events_feature_id_features_id_fk') THEN
    ALTER TABLE "feature_priority_events" ADD CONSTRAINT "feature_priority_events_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "features_company_feature_id_uq" ON "features" USING btree ("company_id","feature_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "features_company_priority_idx" ON "features" USING btree ("company_id","priority_rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "features_company_status_idx" ON "features" USING btree ("company_id","intake_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "features_root_issue_idx" ON "features" USING btree ("root_issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_priority_events_company_feature_idx" ON "feature_priority_events" USING btree ("company_id","feature_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_priority_events_company_created_idx" ON "feature_priority_events" USING btree ("company_id","created_at");
