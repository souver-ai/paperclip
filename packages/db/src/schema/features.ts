import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const features = pgTable(
  "features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    featureId: text("feature_id").notNull(),
    title: text("title").notNull(),
    sourceTeam: text("source_team").notNull().default("ops"),
    intakeStatus: text("intake_status").notNull().default("proposed"),
    priorityRank: integer("priority_rank"),
    pmBrief: jsonb("pm_brief").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    whyNow: text("why_now"),
    impactEstimate: text("impact_estimate"),
    effortEstimate: text("effort_estimate"),
    riskLevel: text("risk_level").notNull().default("medium"),
    productArea: text("product_area").notNull().default("paperclip"),
    repo: text("repo"),
    rootIssueId: uuid("root_issue_id").references(() => issues.id, { onDelete: "set null" }),
    deliveryState: text("delivery_state").notNull().default("intake"),
    requiredEvidence: jsonb("required_evidence").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    terminalEvidence: jsonb("terminal_evidence").$type<Record<string, unknown> | null>(),
    nextAction: text("next_action"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyFeatureIdx: uniqueIndex("features_company_feature_id_uq").on(table.companyId, table.featureId),
    companyPriorityIdx: index("features_company_priority_idx").on(table.companyId, table.priorityRank),
    companyStatusIdx: index("features_company_status_idx").on(table.companyId, table.intakeStatus),
    rootIssueIdx: index("features_root_issue_idx").on(table.rootIssueId),
  }),
);
