CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"title" text NOT NULL,
	"repo" text,
	"product_area" text,
	"feature_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type" text NOT NULL,
	"trigger" text NOT NULL,
	"command" text,
	"owner" text,
	"environment" text,
	"risk_covered" text,
	"required_for_delivery" boolean DEFAULT false NOT NULL,
	"visible_runnable" boolean DEFAULT false NOT NULL,
	"expected_duration_sec" integer,
	"status" text DEFAULT 'designed' NOT NULL,
	"source" text NOT NULL,
	"source_path" text,
	"last_run_id" uuid,
	"last_status" text,
	"last_run_at" timestamp with time zone,
	"last_commit_sha" text,
	"last_branch" text,
	"last_pr_url" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gap_issue_id" uuid,
	"flaky_reason" text,
	"waiver" jsonb,
	"next_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_last_run_id_verification_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_gap_issue_id_issues_id_fk" FOREIGN KEY ("gap_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "test_cases_company_stable_key_uq" ON "test_cases" USING btree ("company_id","stable_key");
--> statement-breakpoint
CREATE INDEX "test_cases_company_repo_idx" ON "test_cases" USING btree ("company_id","repo");
--> statement-breakpoint
CREATE INDEX "test_cases_company_type_idx" ON "test_cases" USING btree ("company_id","type");
--> statement-breakpoint
CREATE INDEX "test_cases_company_status_idx" ON "test_cases" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "test_cases_company_last_status_idx" ON "test_cases" USING btree ("company_id","last_status");
--> statement-breakpoint
CREATE INDEX "test_cases_last_run_idx" ON "test_cases" USING btree ("last_run_id");
