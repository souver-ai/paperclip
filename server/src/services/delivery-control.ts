import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  harnessFindings,
  harnessRuns,
  repoLocks,
  verificationRuns,
} from "@paperclipai/db";
import type {
  CreateHarnessFinding,
  CreateHarnessRun,
  CreateVerificationRun,
  UpdateHarnessFinding,
  UpdateRepoLock,
  UpsertRepoLock,
} from "@paperclipai/shared";

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

function cleanUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function deliveryControlService(db: Db) {
  function listRepoLocks(companyId: string) {
    return db
      .select()
      .from(repoLocks)
      .where(eq(repoLocks.companyId, companyId))
      .orderBy(repoLocks.repo);
  }

  async function getRepoLock(id: string) {
    return db.select().from(repoLocks).where(eq(repoLocks.id, id)).then((rows) => rows[0] ?? null);
  }

  async function upsertRepoLock(companyId: string, input: UpsertRepoLock) {
    const existing = await db
      .select()
      .from(repoLocks)
      .where(and(eq(repoLocks.companyId, companyId), eq(repoLocks.repo, input.repo)))
      .then((rows) => rows[0] ?? null);
    const patch = cleanUndefined({
      state: input.state,
      activeIssueId: input.activeIssueId,
      branch: input.branch,
      prUrl: input.prUrl,
      ownerAgentId: input.ownerAgentId,
      nextAction: input.nextAction,
      blockerType: input.blockerType,
      expiresAt: parseDate(input.expiresAt),
      updatedAt: new Date(),
    });
    if (existing) {
      return db
        .update(repoLocks)
        .set(patch)
        .where(eq(repoLocks.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    }
    return db
      .insert(repoLocks)
      .values({
        companyId,
        repo: input.repo,
        ...patch,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  function updateRepoLock(id: string, input: UpdateRepoLock) {
    return db
      .update(repoLocks)
      .set(cleanUndefined({
        state: input.state,
        activeIssueId: input.activeIssueId,
        branch: input.branch,
        prUrl: input.prUrl,
        ownerAgentId: input.ownerAgentId,
        nextAction: input.nextAction,
        blockerType: input.blockerType,
        expiresAt: parseDate(input.expiresAt),
        updatedAt: new Date(),
      }))
      .where(eq(repoLocks.id, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  function listVerificationRuns(companyId: string) {
    return db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.companyId, companyId))
      .orderBy(desc(verificationRuns.finishedAt), desc(verificationRuns.createdAt));
  }

  function createVerificationRun(companyId: string, input: CreateVerificationRun) {
    return db
      .insert(verificationRuns)
      .values({
        companyId,
        issueId: input.issueId,
        featureId: input.featureId,
        repo: input.repo,
        type: input.type,
        status: input.status,
        command: input.command,
        startedAt: parseDate(input.startedAt) ?? null,
        finishedAt: parseDate(input.finishedAt) ?? null,
        durationSec: input.durationSec,
        commitSha: input.commitSha,
        branch: input.branch,
        prUrl: input.prUrl,
        artifactPaths: input.artifactPaths ?? [],
        verdictSummary: input.verdictSummary,
        failureCategory: input.failureCategory,
        nextAction: input.nextAction,
        ownerAgentId: input.ownerAgentId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  function listHarnessRuns(companyId: string) {
    return db
      .select()
      .from(harnessRuns)
      .where(eq(harnessRuns.companyId, companyId))
      .orderBy(desc(harnessRuns.finishedAt), desc(harnessRuns.createdAt));
  }

  function createHarnessRun(companyId: string, input: CreateHarnessRun) {
    return db
      .insert(harnessRuns)
      .values({
        companyId,
        issueId: input.issueId,
        experimentId: input.experimentId,
        benchmarkName: input.benchmarkName,
        model: input.model,
        status: input.status,
        startedAt: parseDate(input.startedAt) ?? null,
        finishedAt: parseDate(input.finishedAt) ?? null,
        durationSec: input.durationSec,
        score: input.score,
        reportPath: input.reportPath,
        artifactPaths: input.artifactPaths ?? [],
        verdictSummary: input.verdictSummary,
        nextAction: input.nextAction,
        ownerAgentId: input.ownerAgentId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  function listHarnessFindings(companyId: string) {
    return db
      .select()
      .from(harnessFindings)
      .where(eq(harnessFindings.companyId, companyId))
      .orderBy(desc(harnessFindings.createdAt));
  }

  async function getHarnessFinding(id: string) {
    return db.select().from(harnessFindings).where(eq(harnessFindings.id, id)).then((rows) => rows[0] ?? null);
  }

  function createHarnessFinding(companyId: string, input: CreateHarnessFinding) {
    return db
      .insert(harnessFindings)
      .values({
        companyId,
        harnessRunId: input.harnessRunId,
        issueId: input.issueId,
        title: input.title,
        severity: input.severity,
        status: input.status,
        failureCategory: input.failureCategory,
        evidence: input.evidence,
        antiRecurrencePatternId: input.antiRecurrencePatternId,
        nextAction: input.nextAction,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  function updateHarnessFinding(id: string, input: UpdateHarnessFinding) {
    return db
      .update(harnessFindings)
      .set(cleanUndefined({
        harnessRunId: input.harnessRunId,
        issueId: input.issueId,
        title: input.title,
        severity: input.severity,
        status: input.status,
        failureCategory: input.failureCategory,
        evidence: input.evidence,
        antiRecurrencePatternId: input.antiRecurrencePatternId,
        nextAction: input.nextAction,
        updatedAt: new Date(),
      }))
      .where(eq(harnessFindings.id, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  return {
    listRepoLocks,
    getRepoLock,
    upsertRepoLock,
    updateRepoLock,
    listVerificationRuns,
    createVerificationRun,
    listHarnessRuns,
    createHarnessRun,
    listHarnessFindings,
    getHarnessFinding,
    createHarnessFinding,
    updateHarnessFinding,
  };
}
