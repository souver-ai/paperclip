import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Cached view of GitHub pull requests for a company, refreshed lazily from the
// GitHub API. This is the source of truth for the Control Tower PR flow KPIs
// (open / merged-in-window), replacing the earlier delivery-state proxies.
export const pullRequestSnapshots = pgTable(
  "pull_request_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    repoSlug: text("repo_slug").notNull(), // "owner/repo"
    prNumber: integer("pr_number").notNull(),
    prUrl: text("pr_url").notNull(),
    title: text("title").notNull().default(""),
    state: text("state").notNull(), // "open" | "closed"
    isDraft: boolean("is_draft").notNull().default(false),
    isMerged: boolean("is_merged").notNull().default(false),
    headBranch: text("head_branch"),
    baseBranch: text("base_branch"),
    author: text("author"),
    ghCreatedAt: timestamp("gh_created_at", { withTimezone: true }).notNull(),
    ghUpdatedAt: timestamp("gh_updated_at", { withTimezone: true }).notNull(),
    ghClosedAt: timestamp("gh_closed_at", { withTimezone: true }),
    ghMergedAt: timestamp("gh_merged_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRepoPrUq: uniqueIndex("pull_request_snapshots_company_repo_pr_uq").on(
      table.companyId,
      table.repoSlug,
      table.prNumber,
    ),
    companyStateIdx: index("pull_request_snapshots_company_state_idx").on(table.companyId, table.state),
    companyMergedAtIdx: index("pull_request_snapshots_company_merged_at_idx").on(table.companyId, table.ghMergedAt),
  }),
);
