import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  QuotaGovernorCadenceChange,
  QuotaGovernorCadenceSnapshot,
  QuotaGovernorForecast,
} from "@paperclipai/shared";
import { companies } from "./companies.js";

export const quotaGovernorSnapshots = pgTable(
  "quota_governor_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    snapshotDate: text("snapshot_date").notNull(),
    quotaWindowKey: text("quota_window_key").notNull(),
    quotaSource: text("quota_source").notNull(),
    quotaWindow: jsonb("quota_window").$type<Record<string, unknown>>().notNull().default({}),
    windowStartAt: timestamp("window_start_at", { withTimezone: true }),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    usageCents: integer("usage_cents").notNull().default(0),
    quotaLimitCents: integer("quota_limit_cents"),
    providerUsedPercent: doublePrecision("provider_used_percent"),
    projectedUsagePercent: doublePrecision("projected_usage_percent"),
    decision: text("decision").notNull(),
    forecast: jsonb("forecast").$type<QuotaGovernorForecast>().notNull(),
    cadenceSnapshot: jsonb("cadence_snapshot").$type<QuotaGovernorCadenceSnapshot>().notNull(),
    cadenceChanges: jsonb("cadence_changes").$type<QuotaGovernorCadenceChange[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("quota_governor_snapshots_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    companyDateWindowUq: uniqueIndex("quota_governor_snapshots_company_date_window_uq").on(
      table.companyId,
      table.snapshotDate,
      table.quotaWindowKey,
    ),
  }),
);
