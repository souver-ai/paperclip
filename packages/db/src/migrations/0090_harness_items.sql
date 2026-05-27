CREATE TABLE IF NOT EXISTS "harness_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'experiment' NOT NULL,
	"benchmark" text,
	"issue_status" text DEFAULT 'backlog' NOT NULL,
	"delivery_state" text DEFAULT 'intake' NOT NULL,
	"root_issue_id" uuid,
	"next_action" text,
	"owner_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_items_company_id_companies_id_fk') THEN
    ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_items_root_issue_id_issues_id_fk') THEN
    ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harness_items_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "harness_items_company_item_id_uq" ON "harness_items" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_items_company_status_idx" ON "harness_items" USING btree ("company_id","issue_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_items_root_issue_idx" ON "harness_items" USING btree ("root_issue_id");
