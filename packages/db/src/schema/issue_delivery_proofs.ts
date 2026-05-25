import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueDeliveryProofs = pgTable(
  "issue_delivery_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    command: text("command").notNull(),
    description: text("description"),
    surface: text("surface"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_delivery_proofs_company_issue_idx").on(table.companyId, table.issueId),
    companySurfaceIdx: index("issue_delivery_proofs_company_surface_idx").on(table.companyId, table.surface),
    issueUpdatedIdx: index("issue_delivery_proofs_issue_updated_idx").on(table.issueId, table.updatedAt),
  }),
);
