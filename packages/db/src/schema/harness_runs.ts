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

export const harnessRuns = pgTable(
  "harness_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    experimentId: text("experiment_id"),
    benchmarkName: text("benchmark_name"),
    model: text("model"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    score: text("score"),
    reportPath: text("report_path"),
    artifactPaths: jsonb("artifact_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    verdictSummary: text("verdict_summary"),
    nextAction: text("next_action"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("harness_runs_company_issue_idx").on(table.companyId, table.issueId),
    companyExperimentIdx: index("harness_runs_company_experiment_idx").on(table.companyId, table.experimentId),
    companyStatusIdx: index("harness_runs_company_status_idx").on(table.companyId, table.status),
    finishedAtIdx: index("harness_runs_finished_at_idx").on(table.finishedAt),
  }),
);
