import type {
  CreateHarnessFinding,
  CreateHarnessRun,
  CreateVerificationRun,
  AgentThroughput,
  AutoMergeCandidate,
  Feature,
  HarnessFinding,
  HarnessItem,
  HarnessRun,
  RepoLock,
  TestCase,
  TestCaseBackfillSummary,
  UpdateHarnessFinding,
  UpdateFeature,
  UpdateRepoLock,
  UpsertRepoLock,
  UpsertTestCase,
  VerificationRun,
} from "@paperclipai/shared";
import { api } from "./client";

export const deliveryControlApi = {
  listRepoLocks: (companyId: string) => api.get<RepoLock[]>(`/companies/${companyId}/repo-locks`),
  listAgentThroughput: (companyId: string) =>
    api.get<AgentThroughput[]>(`/companies/${companyId}/agent-throughput`),
  listFeatures: (companyId: string) =>
    api.get<Feature[]>(`/companies/${companyId}/features`),
  backfillFeaturesFromIssues: (companyId: string) =>
    api.post<{ created: number; updated: number; skipped: number; features: Feature[] }>(`/companies/${companyId}/features/backfill-from-issues`, {}),
  updateFeature: (id: string, data: UpdateFeature) => api.patch<Feature>(`/features/${id}`, data),
  listAutoMergeCandidates: (companyId: string) =>
    api.get<AutoMergeCandidate[]>(`/companies/${companyId}/auto-merge-candidates`),
  upsertRepoLock: (companyId: string, data: UpsertRepoLock) =>
    api.post<RepoLock>(`/companies/${companyId}/repo-locks`, data),
  updateRepoLock: (id: string, data: UpdateRepoLock) => api.patch<RepoLock>(`/repo-locks/${id}`, data),
  listVerificationRuns: (companyId: string) =>
    api.get<VerificationRun[]>(`/companies/${companyId}/verification-runs`),
  createVerificationRun: (companyId: string, data: CreateVerificationRun) =>
    api.post<VerificationRun>(`/companies/${companyId}/verification-runs`, data),
  listTestCases: (companyId: string) =>
    api.get<TestCase[]>(`/companies/${companyId}/test-cases`),
  backfillSouverTestCases: (companyId: string) =>
    api.post<TestCaseBackfillSummary>(`/companies/${companyId}/test-cases/backfill-souver`, {}),
  upsertTestCase: (companyId: string, data: UpsertTestCase) =>
    api.post<TestCase>(`/companies/${companyId}/test-cases`, data),
  listHarnessRuns: (companyId: string) => api.get<HarnessRun[]>(`/companies/${companyId}/harness-runs`),
  createHarnessRun: (companyId: string, data: CreateHarnessRun) =>
    api.post<HarnessRun>(`/companies/${companyId}/harness-runs`, data),
  listHarnessItems: (companyId: string) =>
    api.get<HarnessItem[]>(`/companies/${companyId}/harness-items`),
  backfillHarnessItemsFromIssues: (companyId: string) =>
    api.post<{ created: number; updated: number; skipped: number; items: HarnessItem[] }>(`/companies/${companyId}/harness-items/backfill-from-issues`, {}),
  listHarnessFindings: (companyId: string) =>
    api.get<HarnessFinding[]>(`/companies/${companyId}/harness-findings`),
  createHarnessFinding: (companyId: string, data: CreateHarnessFinding) =>
    api.post<HarnessFinding>(`/companies/${companyId}/harness-findings`, data),
  updateHarnessFinding: (id: string, data: UpdateHarnessFinding) =>
    api.patch<HarnessFinding>(`/harness-findings/${id}`, data),
};
