ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'uncategorized' NOT NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "surfaces" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_category_check') THEN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_category_check" CHECK ("category" in (
      'feature',
      'process',
      'bugfix',
      'test_review',
      'security_audit',
      'harness_benchmark',
      'architecture_review',
      'kb_docs',
      'ops',
      'approval',
      'research',
      'acquisition',
      'funding',
      'uncategorized'
    )) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "issues" VALIDATE CONSTRAINT "issues_category_check";
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_surfaces_array_check') THEN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_surfaces_array_check" CHECK (
      jsonb_typeof("surfaces") = 'array'
      AND "surfaces" <@ '[
        "paperclip",
        "dashboard",
        "app_cli",
        "desktop",
        "inference",
        "souver_research",
        "parent_kb_ops",
        "external"
      ]'::jsonb
    ) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "issues" VALIDATE CONSTRAINT "issues_surfaces_array_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_company_category_idx" ON "issues" USING btree ("company_id","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_surfaces_gin_idx" ON "issues" USING gin ("surfaces");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_delivery_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "name" text NOT NULL,
  "command" text NOT NULL,
  "description" text,
  "surface" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_delivery_proofs_company_id_companies_id_fk') THEN
    ALTER TABLE "issue_delivery_proofs" ADD CONSTRAINT "issue_delivery_proofs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_delivery_proofs_issue_id_issues_id_fk') THEN
    ALTER TABLE "issue_delivery_proofs" ADD CONSTRAINT "issue_delivery_proofs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_delivery_proofs_surface_check') THEN
    ALTER TABLE "issue_delivery_proofs" ADD CONSTRAINT "issue_delivery_proofs_surface_check" CHECK (
      "surface" IS NULL OR "surface" in (
        'paperclip',
        'dashboard',
        'app_cli',
        'desktop',
        'inference',
        'souver_research',
        'parent_kb_ops',
        'external'
      )
    ) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "issue_delivery_proofs" VALIDATE CONSTRAINT "issue_delivery_proofs_surface_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_delivery_proofs_company_issue_idx" ON "issue_delivery_proofs" USING btree ("company_id","issue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_delivery_proofs_company_surface_idx" ON "issue_delivery_proofs" USING btree ("company_id","surface");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_delivery_proofs_issue_updated_idx" ON "issue_delivery_proofs" USING btree ("issue_id","updated_at");
