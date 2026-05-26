import type {
  CreateHarnessFinding,
  CreateHarnessRun,
  CreateVerificationRun,
  AgentThroughput,
  AutoMergeCandidate,
  HarnessFinding,
  HarnessRun,
  RepoLock,
  UpdateHarnessFinding,
  UpdateRepoLock,
  UpsertRepoLock,
  VerificationRun,
} from "@paperclipai/shared";
import { api } from "./client";

export const deliveryControlApi = {
  listRepoLocks: (companyId: string) => api.get<RepoLock[]>(`/companies/${companyId}/repo-locks`),
  listAgentThroughput: (companyId: string) =>
    api.get<AgentThroughput[]>(`/companies/${companyId}/agent-throughput`),
  listAutoMergeCandidates: (companyId: string) =>
    api.get<AutoMergeCandidate[]>(`/companies/${companyId}/auto-merge-candidates`),
  upsertRepoLock: (companyId: string, data: UpsertRepoLock) =>
    api.post<RepoLock>(`/companies/${companyId}/repo-locks`, data),
  updateRepoLock: (id: string, data: UpdateRepoLock) => api.patch<RepoLock>(`/repo-locks/${id}`, data),
  listVerificationRuns: (companyId: string) =>
    api.get<VerificationRun[]>(`/companies/${companyId}/verification-runs`),
  createVerificationRun: (companyId: string, data: CreateVerificationRun) =>
    api.post<VerificationRun>(`/companies/${companyId}/verification-runs`, data),
  listHarnessRuns: (companyId: string) => api.get<HarnessRun[]>(`/companies/${companyId}/harness-runs`),
  createHarnessRun: (companyId: string, data: CreateHarnessRun) =>
    api.post<HarnessRun>(`/companies/${companyId}/harness-runs`, data),
  listHarnessFindings: (companyId: string) =>
    api.get<HarnessFinding[]>(`/companies/${companyId}/harness-findings`),
  createHarnessFinding: (companyId: string, data: CreateHarnessFinding) =>
    api.post<HarnessFinding>(`/companies/${companyId}/harness-findings`, data),
  updateHarnessFinding: (id: string, data: UpdateHarnessFinding) =>
    api.patch<HarnessFinding>(`/harness-findings/${id}`, data),
};
