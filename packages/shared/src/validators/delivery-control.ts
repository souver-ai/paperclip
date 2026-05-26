import { z } from "zod";
import {
  BLOCKER_TYPES,
  DELIVERY_STATES,
  FEATURE_INTAKE_STATUSES,
  FEATURE_RISK_LEVELS,
  FEATURE_SOURCE_TEAMS,
  HARNESS_FINDING_SEVERITIES,
  HARNESS_FINDING_STATUSES,
  HARNESS_RUN_STATUSES,
  ISSUE_SURFACES,
  REPO_LOCK_STATES,
  TEST_CASE_LAST_STATUSES,
  TEST_CASE_SOURCES,
  TEST_CASE_STATUSES,
  TEST_CASE_TRIGGERS,
  TEST_CASE_TYPES,
  VERIFICATION_FAILURE_CATEGORIES,
  VERIFICATION_RUN_STATUSES,
  VERIFICATION_RUN_TYPES,
} from "../constants.js";

const surfaceOrRepoSchema = z.union([z.enum(ISSUE_SURFACES), z.string().trim().min(1).max(120)]);
const optionalDatetimeSchema = z.string().datetime().optional().nullable();
const artifactPathsSchema = z.array(z.string().trim().min(1).max(1000)).max(100).optional();

export const upsertRepoLockSchema = z.object({
  repo: surfaceOrRepoSchema,
  state: z.enum(REPO_LOCK_STATES).optional().default("free"),
  activeIssueId: z.string().uuid().optional().nullable(),
  branch: z.string().trim().min(1).max(240).optional().nullable(),
  prUrl: z.string().trim().url().max(1000).optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
  nextAction: z.string().trim().max(2000).optional().nullable(),
  blockerType: z.enum(BLOCKER_TYPES).optional().nullable(),
  expiresAt: optionalDatetimeSchema,
}).strict();

export type UpsertRepoLock = z.infer<typeof upsertRepoLockSchema>;

export const updateRepoLockSchema = upsertRepoLockSchema.partial().omit({ repo: true });

export type UpdateRepoLock = z.infer<typeof updateRepoLockSchema>;

const pmBriefSchema = z.record(z.string(), z.unknown()).optional().default({});
const requiredEvidenceSchema = z.array(z.string().trim().min(1).max(240)).max(50).optional().default([]);

export const createFeatureSchema = z.object({
  featureId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  sourceTeam: z.enum(FEATURE_SOURCE_TEAMS).optional().default("ops"),
  intakeStatus: z.enum(FEATURE_INTAKE_STATUSES).optional().default("proposed"),
  priorityRank: z.number().int().nonnegative().optional().nullable(),
  pmBrief: pmBriefSchema,
  whyNow: z.string().trim().max(2000).optional().nullable(),
  impactEstimate: z.string().trim().max(500).optional().nullable(),
  effortEstimate: z.string().trim().max(500).optional().nullable(),
  riskLevel: z.enum(FEATURE_RISK_LEVELS).optional().default("medium"),
  productArea: z.string().trim().min(1).max(160).optional().default("paperclip"),
  repo: surfaceOrRepoSchema.optional().nullable(),
  rootIssueId: z.string().uuid().optional().nullable(),
  deliveryState: z.enum(DELIVERY_STATES).optional().default("intake"),
  requiredEvidence: requiredEvidenceSchema,
  terminalEvidence: z.record(z.string(), z.unknown()).optional().nullable(),
  nextAction: z.string().trim().max(2000).optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
}).strict();

export type CreateFeature = z.infer<typeof createFeatureSchema>;

export const updateFeatureSchema = createFeatureSchema.partial().omit({ featureId: true });

export type UpdateFeature = z.infer<typeof updateFeatureSchema>;

export const createVerificationRunSchema = z.object({
  issueId: z.string().uuid().optional().nullable(),
  featureId: z.string().trim().min(1).max(160).optional().nullable(),
  repo: surfaceOrRepoSchema.optional().nullable(),
  type: z.enum(VERIFICATION_RUN_TYPES),
  status: z.enum(VERIFICATION_RUN_STATUSES),
  command: z.string().trim().min(1).max(4000).optional().nullable(),
  startedAt: optionalDatetimeSchema,
  finishedAt: optionalDatetimeSchema,
  durationSec: z.number().int().nonnegative().optional().nullable(),
  commitSha: z.string().trim().min(7).max(80).optional().nullable(),
  branch: z.string().trim().min(1).max(240).optional().nullable(),
  prUrl: z.string().trim().url().max(1000).optional().nullable(),
  artifactPaths: artifactPathsSchema,
  verdictSummary: z.string().trim().max(2000).optional().nullable(),
  failureCategory: z.enum(VERIFICATION_FAILURE_CATEGORIES).optional().nullable(),
  nextAction: z.string().trim().max(2000).optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
}).strict();

export type CreateVerificationRun = z.infer<typeof createVerificationRunSchema>;

const stringArraySchema = z.array(z.string().trim().min(1).max(240)).max(100).optional();

export const upsertTestCaseSchema = z.object({
  stableKey: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  repo: surfaceOrRepoSchema.optional().nullable(),
  productArea: z.string().trim().min(1).max(160).optional().nullable(),
  featureIds: stringArraySchema,
  issueIds: stringArraySchema,
  type: z.enum(TEST_CASE_TYPES),
  trigger: z.enum(TEST_CASE_TRIGGERS),
  command: z.string().trim().min(1).max(4000).optional().nullable(),
  owner: z.string().trim().min(1).max(240).optional().nullable(),
  environment: z.string().trim().min(1).max(240).optional().nullable(),
  riskCovered: z.string().trim().max(4000).optional().nullable(),
  requiredForDelivery: z.boolean().optional().default(false),
  visibleRunnable: z.boolean().optional().default(false),
  expectedDurationSec: z.number().int().nonnegative().optional().nullable(),
  status: z.enum(TEST_CASE_STATUSES).optional().default("designed"),
  source: z.enum(TEST_CASE_SOURCES),
  sourcePath: z.string().trim().min(1).max(1000).optional().nullable(),
  lastRunId: z.string().uuid().optional().nullable(),
  lastStatus: z.enum(TEST_CASE_LAST_STATUSES).optional().nullable(),
  lastRunAt: optionalDatetimeSchema,
  lastCommitSha: z.string().trim().min(7).max(80).optional().nullable(),
  lastBranch: z.string().trim().min(1).max(240).optional().nullable(),
  lastPrUrl: z.string().trim().url().max(1000).optional().nullable(),
  artifactRefs: artifactPathsSchema,
  gapIssueId: z.string().uuid().optional().nullable(),
  flakyReason: z.string().trim().max(2000).optional().nullable(),
  waiver: z.record(z.string(), z.unknown()).optional().nullable(),
  nextAction: z.string().trim().max(4000).optional().nullable(),
}).strict();

export type UpsertTestCase = z.infer<typeof upsertTestCaseSchema>;

export const createHarnessRunSchema = z.object({
  issueId: z.string().uuid().optional().nullable(),
  experimentId: z.string().trim().min(1).max(160).optional().nullable(),
  benchmarkName: z.string().trim().min(1).max(240).optional().nullable(),
  model: z.string().trim().min(1).max(240).optional().nullable(),
  status: z.enum(HARNESS_RUN_STATUSES),
  startedAt: optionalDatetimeSchema,
  finishedAt: optionalDatetimeSchema,
  durationSec: z.number().int().nonnegative().optional().nullable(),
  score: z.string().trim().min(1).max(120).optional().nullable(),
  reportPath: z.string().trim().min(1).max(1000).optional().nullable(),
  artifactPaths: artifactPathsSchema,
  verdictSummary: z.string().trim().max(2000).optional().nullable(),
  nextAction: z.string().trim().max(2000).optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
}).strict();

export type CreateHarnessRun = z.infer<typeof createHarnessRunSchema>;

export const createHarnessFindingSchema = z.object({
  harnessRunId: z.string().uuid().optional().nullable(),
  issueId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(240),
  severity: z.enum(HARNESS_FINDING_SEVERITIES).optional().default("medium"),
  status: z.enum(HARNESS_FINDING_STATUSES).optional().default("open"),
  failureCategory: z.enum(VERIFICATION_FAILURE_CATEGORIES).optional().nullable(),
  evidence: z.record(z.string(), z.unknown()).optional().default({}),
  antiRecurrencePatternId: z.string().trim().min(1).max(160).optional().nullable(),
  nextAction: z.string().trim().max(2000).optional().nullable(),
}).strict();

export type CreateHarnessFinding = z.infer<typeof createHarnessFindingSchema>;

export const updateHarnessFindingSchema = createHarnessFindingSchema.partial();

export type UpdateHarnessFinding = z.infer<typeof updateHarnessFindingSchema>;
