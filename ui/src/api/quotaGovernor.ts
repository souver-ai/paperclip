import type { QuotaGovernorLoadResult } from "@paperclipai/shared";
import { api } from "./client";

export const quotaGovernorApi = {
  get: (companyId: string) =>
    api.get<QuotaGovernorLoadResult>(`/companies/${companyId}/quota-governor`),
};
