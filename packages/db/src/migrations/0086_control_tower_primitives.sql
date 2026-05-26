ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "delivery_state" text DEFAULT 'intake' NOT NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "blocker_type" text;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "terminal_evidence" jsonb;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "next_action" text;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "benjamin_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "auto_merge_eligible" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "repo_lock_id" uuid;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "anti_recurrence_pattern_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_delivery_state_check') THEN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_delivery_state_check" CHECK ("delivery_state" in (
      'intake',
      'queued_repo_gate',
      'active_branch',
      'pr_ready',
      'in_review',
      'changes_requested',
      'merge_ready',
      'merged',
      'target_verifying',
      'merged_verified',
      'live_verified',
      'waived_by_benjamin',
      'parked_hold'
    )) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "issues" VALIDATE CONSTRAINT "issues_delivery_state_check";
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_blocker_type_check') THEN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_blocker_type_check" CHECK (
      "blocker_type" IS NULL OR "blocker_type" in (
        'repo_dirty',
        'branch_stale',
        'port_main',
        'preflight_failed',
        'github_token',
        'missing_pr',
        'security_gate',
        'test_gate',
        'harness_runtime',
        'credential_binding',
        'approval_benjamin',
        'operator_runtime',
        'product_scope',
        'external_dependency',
        'unknown'
      )
    ) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "issues" VALIDATE CONSTRAINT "issues_blocker_type_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_company_delivery_state_idx" ON "issues" USING btree ("company_id","delivery_state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_company_blocker_type_idx" ON "issues" USING btree ("company_id","blocker_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_company_benjamin_required_idx" ON "issues" USING btree ("company_id","benjamin_required");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_company_repo_lock_idx" ON "issues" USING btree ("company_id","repo_lock_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo" text NOT NULL,
  "state" text DEFAULT 'free' NOT NULL,
  "active_issue_id" uuid,
  "branch" text,
  "pr_url" text,
  "owner_agent_id" uuid,
  "next_action" text,
  "blocker_type" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid,
  "feature_id" text,
  "repo" text,
  "type" text NOT NULL,
  "status" text NOT NULL,
  "command" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "duration_sec" integer,
  "commit_sha" text,
  "branch" text,
  "pr_url" text,
  "artifact_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "verdict_summary" text,
  "failure_category" text,
  "next_action" text,
  "owner_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "harness_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid,
  "experiment_id" text,
  "benchmark_name" text,
  "model" text,
  "status" text NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "duration_sec" integer,
  "score" text,
  "report_path" text,
  "artifact_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "verdict_summary" text,
  "next_action" text,
  "owner_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "harness_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "harness_run_id" uuid,
  "issue_id" uuid,
  "title" text NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "failure_category" text,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "anti_recurrence_pattern_id" text,
  "next_action" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repo_locks_company_id_companies_id_fk') THEN
    ALTER TABLE "repo_locks" ADD CONSTRAINT "repo_locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repo_locks_active_issue_id_issues_id_fk') THEN
    ALTER TABLE "repo_locks" ADD CONSTRAINT "repo_locks_active_issue_id_issues_id_fk" FOREIGN KEY ("active_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repo_locks_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "repo_locks" ADD CONSTRAINT "repo_locks_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_runs_company_id_companies_id_fk') THEN
    ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_runs_issue_id_issues_id_fk') THEN
    ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_runs_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_runs_company_id_companies_id_fk') THEN
    ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_runs_issue_id_issues_id_fk') THEN
    ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_runs_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_findings_company_id_companies_id_fk') THEN
    ALTER TABLE "harness_findings" ADD CONSTRAINT "harness_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_findings_harness_run_id_harness_runs_id_fk') THEN
    ALTER TABLE "harness_findings" ADD CONSTRAINT "harness_findings_harness_run_id_harness_runs_id_fk" FOREIGN KEY ("harness_run_id") REFERENCES "public"."harness_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_findings_issue_id_issues_id_fk') THEN
    ALTER TABLE "harness_findings" ADD CONSTRAINT "harness_findings_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repo_locks_company_repo_uq" ON "repo_locks" USING btree ("company_id","repo");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_locks_company_state_idx" ON "repo_locks" USING btree ("company_id","state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_locks_active_issue_idx" ON "repo_locks" USING btree ("active_issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_locks_expires_at_idx" ON "repo_locks" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_runs_company_issue_idx" ON "verification_runs" USING btree ("company_id","issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_runs_company_feature_idx" ON "verification_runs" USING btree ("company_id","feature_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_runs_company_repo_status_idx" ON "verification_runs" USING btree ("company_id","repo","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_runs_finished_at_idx" ON "verification_runs" USING btree ("finished_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_runs_company_issue_idx" ON "harness_runs" USING btree ("company_id","issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_runs_company_experiment_idx" ON "harness_runs" USING btree ("company_id","experiment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_runs_company_status_idx" ON "harness_runs" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_runs_finished_at_idx" ON "harness_runs" USING btree ("finished_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_findings_company_run_idx" ON "harness_findings" USING btree ("company_id","harness_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_findings_company_status_idx" ON "harness_findings" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_findings_company_severity_idx" ON "harness_findings" USING btree ("company_id","severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_findings_issue_idx" ON "harness_findings" USING btree ("issue_id");
