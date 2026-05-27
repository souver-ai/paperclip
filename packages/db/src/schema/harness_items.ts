import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

// Registry of harness work items (benchmarks, experiments, baselines) backfilled from harness
// issues, so the Harness view is exhaustive: delivered/abandoned/in-progress, not just live runs.
// Distinct from harness_runs (actual benchmark executions) and harness_findings (defects).
export const harnessItems = pgTable(
  "harness_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("experiment"),
    benchmark: text("benchmark"),
    issueStatus: text("issue_status").notNull().default("backlog"),
    deliveryState: text("delivery_state").notNull().default("intake"),
    rootIssueId: uuid("root_issue_id").references(() => issues.id, { onDelete: "set null" }),
    nextAction: text("next_action"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyItemIdx: uniqueIndex("harness_items_company_item_id_uq").on(table.companyId, table.itemId),
    companyStatusIdx: index("harness_items_company_status_idx").on(table.companyId, table.issueStatus),
    rootIssueIdx: index("harness_items_root_issue_idx").on(table.rootIssueId),
  }),
);
