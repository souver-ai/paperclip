import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    featureId: text("feature_id"),
    repo: text("repo"),
    type: text("type").notNull(),
    status: text("status").notNull(),
    command: text("command"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    commitSha: text("commit_sha"),
    branch: text("branch"),
    prUrl: text("pr_url"),
    artifactPaths: jsonb("artifact_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    verdictSummary: text("verdict_summary"),
    failureCategory: text("failure_category"),
    nextAction: text("next_action"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("verification_runs_company_issue_idx").on(table.companyId, table.issueId),
    companyFeatureIdx: index("verification_runs_company_feature_idx").on(table.companyId, table.featureId),
    companyRepoStatusIdx: index("verification_runs_company_repo_status_idx").on(table.companyId, table.repo, table.status),
    finishedAtIdx: index("verification_runs_finished_at_idx").on(table.finishedAt),
  }),
);
