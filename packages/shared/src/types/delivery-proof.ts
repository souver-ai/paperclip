import type { IssueSurface } from "../constants.js";

export interface IssueDeliveryProof {
  id: string;
  companyId: string;
  issueId: string;
  name: string;
  command: string;
  description: string | null;
  surface: IssueSurface | null;
  createdAt: Date;
  updatedAt: Date;
}
