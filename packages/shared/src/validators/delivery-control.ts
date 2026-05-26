import { z } from "zod";
import {
  BLOCKER_TYPES,
  HARNESS_FINDING_SEVERITIES,
  HARNESS_FINDING_STATUSES,
  HARNESS_RUN_STATUSES,
  ISSUE_SURFACES,
  REPO_LOCK_STATES,
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
