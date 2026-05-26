import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { features } from "./features.js";

export const featurePriorityEvents = pgTable(
  "feature_priority_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id").notNull().references(() => features.id, { onDelete: "cascade" }),
    fromRank: integer("from_rank"),
    toRank: integer("to_rank"),
    changedBy: text("changed_by"),
    reason: text("reason"),
    previousIntakeStatus: text("previous_intake_status"),
    newIntakeStatus: text("new_intake_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyFeatureIdx: index("feature_priority_events_company_feature_idx").on(table.companyId, table.featureId),
    companyCreatedIdx: index("feature_priority_events_company_created_idx").on(table.companyId, table.createdAt),
  }),
);
