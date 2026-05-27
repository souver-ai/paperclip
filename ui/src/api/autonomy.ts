import type { AutonomyPeriodKey, AutonomyReport } from "@paperclipai/shared";
import { api } from "./client";

export const autonomyApi = {
  get: (companyId: string, period: AutonomyPeriodKey) =>
    api.get<AutonomyReport>(`/companies/${companyId}/autonomy?period=${period}`),
};
