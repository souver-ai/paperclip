DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_blocker_type_check') THEN
    ALTER TABLE "issues" DROP CONSTRAINT "issues_blocker_type_check";
  END IF;
END $$;
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
        'tail_waiting',
        'waiver_candidate',
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
