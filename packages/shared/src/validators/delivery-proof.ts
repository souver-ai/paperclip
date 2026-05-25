import { z } from "zod";
import { ISSUE_SURFACES } from "../constants.js";

export const issueDeliveryProofSurfaceSchema = z.enum(ISSUE_SURFACES);

export const createIssueDeliveryProofSchema = z.object({
  name: z.string().trim().min(1).max(160),
  command: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(4000).optional().nullable(),
  surface: issueDeliveryProofSurfaceSchema.optional().nullable(),
});

export type CreateIssueDeliveryProof = z.infer<typeof createIssueDeliveryProofSchema>;

export const updateIssueDeliveryProofSchema = createIssueDeliveryProofSchema.partial();

export type UpdateIssueDeliveryProof = z.infer<typeof updateIssueDeliveryProofSchema>;
