import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  harnessFindings,
  harnessRuns,
  heartbeatRuns,
  issues,
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

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

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

  async function listAgentThroughput(companyId: string) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        status: agents.status,
        lastHeartbeatAt: agents.lastHeartbeatAt,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId))
      .orderBy(agents.name);

    const issueRows = await db
      .select({
        agentId: issues.assigneeAgentId,
        assignedOpenIssues: sql<number>`count(*) filter (where ${issues.status} not in ('done', 'cancelled') and ${issues.hiddenAt} is null)::int`,
        assignedBlockedIssues: sql<number>`count(*) filter (where ${issues.status} = 'blocked' and ${issues.hiddenAt} is null)::int`,
        assignedInReviewIssues: sql<number>`count(*) filter (where ${issues.status} = 'in_review' and ${issues.hiddenAt} is null)::int`,
        completedIssues7d: sql<number>`count(*) filter (where ${issues.status} = 'done' and ${issues.completedAt} >= ${since7d}::timestamptz and ${issues.hiddenAt} is null)::int`,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), isNotNull(issues.assigneeAgentId)))
      .groupBy(issues.assigneeAgentId);

    const createdIssueRows = await db
      .select({
        agentId: issues.createdByAgentId,
        createdIssues7d: sql<number>`count(*) filter (where ${issues.createdAt} >= ${since7d}::timestamptz and ${issues.hiddenAt} is null)::int`,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), isNotNull(issues.createdByAgentId)))
      .groupBy(issues.createdByAgentId);

    const runRows = await db
      .select({
        agentId: heartbeatRuns.agentId,
        runs24h: sql<number>`count(*)::int`,
        successfulRuns24h: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'succeeded')::int`,
        failedRuns24h: sql<number>`count(*) filter (where ${heartbeatRuns.status} in ('failed', 'timed_out', 'cancelled'))::int`,
        productiveRuns24h: sql<number>`count(*) filter (where ${heartbeatRuns.livenessState} in ('completed', 'advanced'))::int`,
        planOnlyRuns24h: sql<number>`count(*) filter (where ${heartbeatRuns.livenessState} in ('plan_only', 'empty_response'))::int`,
        blockedRuns24h: sql<number>`count(*) filter (where ${heartbeatRuns.livenessState} in ('blocked', 'failed', 'needs_followup'))::int`,
        lastRunAt: sql<Date | null>`max(coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt}))`,
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), sql`${heartbeatRuns.createdAt} >= ${since24h}::timestamptz`))
      .groupBy(heartbeatRuns.agentId);

    const activityRows = await db
      .select({
        agentId: activityLog.agentId,
        activityEvents24h: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), isNotNull(activityLog.agentId), sql`${activityLog.createdAt} >= ${since24h}::timestamptz`))
      .groupBy(activityLog.agentId);

    const issueByAgent = new Map(issueRows.map((row) => [row.agentId, row]));
    const createdByAgent = new Map(createdIssueRows.map((row) => [row.agentId, row]));
    const runsByAgent = new Map(runRows.map((row) => [row.agentId, row]));
    const activityByAgent = new Map(activityRows.map((row) => [row.agentId, row]));

    return agentRows
      .map((agent) => {
        const issueStats = issueByAgent.get(agent.id);
        const createdStats = createdByAgent.get(agent.id);
        const runStats = runsByAgent.get(agent.id);
        const activityStats = activityByAgent.get(agent.id);
        return {
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          lastHeartbeatAt: agent.lastHeartbeatAt,
          assignedOpenIssues: numberValue(issueStats?.assignedOpenIssues),
          assignedBlockedIssues: numberValue(issueStats?.assignedBlockedIssues),
          assignedInReviewIssues: numberValue(issueStats?.assignedInReviewIssues),
          createdIssues7d: numberValue(createdStats?.createdIssues7d),
          completedIssues7d: numberValue(issueStats?.completedIssues7d),
          runs24h: numberValue(runStats?.runs24h),
          successfulRuns24h: numberValue(runStats?.successfulRuns24h),
          failedRuns24h: numberValue(runStats?.failedRuns24h),
          productiveRuns24h: numberValue(runStats?.productiveRuns24h),
          planOnlyRuns24h: numberValue(runStats?.planOnlyRuns24h),
          blockedRuns24h: numberValue(runStats?.blockedRuns24h),
          activityEvents24h: numberValue(activityStats?.activityEvents24h),
          lastRunAt: runStats?.lastRunAt ?? null,
        };
      })
      .sort((a, b) => {
        const blockedDelta = b.assignedBlockedIssues + b.blockedRuns24h - (a.assignedBlockedIssues + a.blockedRuns24h);
        if (blockedDelta !== 0) return blockedDelta;
        const openDelta = b.assignedOpenIssues - a.assignedOpenIssues;
        if (openDelta !== 0) return openDelta;
        const productiveDelta = b.productiveRuns24h - a.productiveRuns24h;
        if (productiveDelta !== 0) return productiveDelta;
        return a.name.localeCompare(b.name);
      });
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
    listAgentThroughput,
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
