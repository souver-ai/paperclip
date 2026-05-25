import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueDeliveryProofs } from "@paperclipai/db";
import type { IssueDeliveryProof } from "@paperclipai/shared";

type IssueDeliveryProofRow = typeof issueDeliveryProofs.$inferSelect;

function toIssueDeliveryProof(row: IssueDeliveryProofRow): IssueDeliveryProof {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    name: row.name,
    command: row.command,
    description: row.description ?? null,
    surface: row.surface as IssueDeliveryProof["surface"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function deliveryProofService(db: Db) {
  return {
    listForIssue: async (issueId: string) => {
      const rows = await db
        .select()
        .from(issueDeliveryProofs)
        .where(eq(issueDeliveryProofs.issueId, issueId))
        .orderBy(desc(issueDeliveryProofs.updatedAt), desc(issueDeliveryProofs.id));
      return rows.map(toIssueDeliveryProof);
    },

    countForIssues: async (issueIds: string[]) => {
      const result = new Map<string, number>();
      if (issueIds.length === 0) return result;
      const rows = await db
        .select({ issueId: issueDeliveryProofs.issueId })
        .from(issueDeliveryProofs)
        .where(inArray(issueDeliveryProofs.issueId, issueIds));
      for (const row of rows) {
        result.set(row.issueId, (result.get(row.issueId) ?? 0) + 1);
      }
      return result;
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issueDeliveryProofs)
        .where(eq(issueDeliveryProofs.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toIssueDeliveryProof(row) : null;
    },

    createForIssue: async (
      issueId: string,
      companyId: string,
      data: Omit<typeof issueDeliveryProofs.$inferInsert, "issueId" | "companyId">,
    ) => {
      const row = await db
        .insert(issueDeliveryProofs)
        .values({ ...data, companyId, issueId })
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueDeliveryProof(row) : null;
    },

    update: async (id: string, patch: Partial<typeof issueDeliveryProofs.$inferInsert>) => {
      const row = await db
        .update(issueDeliveryProofs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(issueDeliveryProofs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueDeliveryProof(row) : null;
    },

    remove: async (id: string) => {
      const row = await db
        .delete(issueDeliveryProofs)
        .where(eq(issueDeliveryProofs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueDeliveryProof(row) : null;
    },
  };
}

export { toIssueDeliveryProof };
