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

export const repoLocks = pgTable(
  "repo_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    state: text("state").notNull().default("free"),
    activeIssueId: uuid("active_issue_id").references(() => issues.id, { onDelete: "set null" }),
    branch: text("branch"),
    prUrl: text("pr_url"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    nextAction: text("next_action"),
    blockerType: text("blocker_type"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRepoIdx: uniqueIndex("repo_locks_company_repo_uq").on(table.companyId, table.repo),
    companyStateIdx: index("repo_locks_company_state_idx").on(table.companyId, table.state),
    activeIssueIdx: index("repo_locks_active_issue_idx").on(table.activeIssueId),
    expiresAtIdx: index("repo_locks_expires_at_idx").on(table.expiresAt),
  }),
);
