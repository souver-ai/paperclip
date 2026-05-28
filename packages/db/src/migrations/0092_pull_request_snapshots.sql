CREATE TABLE IF NOT EXISTS "pull_request_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repo_slug" text NOT NULL,
  "pr_number" integer NOT NULL,
  "pr_url" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "state" text NOT NULL,
  "is_draft" boolean DEFAULT false NOT NULL,
  "is_merged" boolean DEFAULT false NOT NULL,
  "head_branch" text,
  "base_branch" text,
  "author" text,
  "gh_created_at" timestamp with time zone NOT NULL,
  "gh_updated_at" timestamp with time zone NOT NULL,
  "gh_closed_at" timestamp with time zone,
  "gh_merged_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_pr_sync_state" (
  "company_id" uuid PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'idle' NOT NULL,
  "last_sync_started_at" timestamp with time zone,
  "last_sync_finished_at" timestamp with time zone,
  "error" text,
  "repos_synced" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pull_request_snapshots_company_id_companies_id_fk') THEN
    ALTER TABLE "pull_request_snapshots" ADD CONSTRAINT "pull_request_snapshots_company_id_companies_id_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'github_pr_sync_state_company_id_companies_id_fk') THEN
    ALTER TABLE "github_pr_sync_state" ADD CONSTRAINT "github_pr_sync_state_company_id_companies_id_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_request_snapshots_company_repo_pr_uq" ON "pull_request_snapshots" ("company_id","repo_slug","pr_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_snapshots_company_state_idx" ON "pull_request_snapshots" ("company_id","state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_snapshots_company_merged_at_idx" ON "pull_request_snapshots" ("company_id","gh_merged_at");
