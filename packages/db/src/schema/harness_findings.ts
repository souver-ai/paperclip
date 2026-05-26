import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { harnessRuns } from "./harness_runs.js";
import { issues } from "./issues.js";

export const harnessFindings = pgTable(
  "harness_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    harnessRunId: uuid("harness_run_id").references(() => harnessRuns.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    failureCategory: text("failure_category"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    antiRecurrencePatternId: text("anti_recurrence_pattern_id"),
    nextAction: text("next_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRunIdx: index("harness_findings_company_run_idx").on(table.companyId, table.harnessRunId),
    companyStatusIdx: index("harness_findings_company_status_idx").on(table.companyId, table.status),
    companySeverityIdx: index("harness_findings_company_severity_idx").on(table.companyId, table.severity),
    issueIdx: index("harness_findings_issue_idx").on(table.issueId),
  }),
);
