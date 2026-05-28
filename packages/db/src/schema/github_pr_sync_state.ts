import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// One row per company tracking the lazy GitHub PR sync: when it last ran, its
// status, and per-repo outcomes (so the UI can surface unreachable repos in
// the source-health row instead of silently undercounting).
export const githubPrSyncState = pgTable("github_pr_sync_state", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("idle"), // idle | syncing | ok | error
  lastSyncStartedAt: timestamp("last_sync_started_at", { withTimezone: true }),
  lastSyncFinishedAt: timestamp("last_sync_finished_at", { withTimezone: true }),
  error: text("error"),
  // Array<{ slug: string; ok: boolean; count: number; error?: string }>
  reposSynced: jsonb("repos_synced").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
