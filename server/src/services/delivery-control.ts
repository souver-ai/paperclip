import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  featurePriorityEvents,
  features,
  harnessFindings,
  harnessRuns,
  heartbeatRuns,
  issues,
  repoLocks,
  verificationRuns,
} from "@paperclipai/db";
import type {
  AutoMergeCandidate,
  CreateFeature,
  CreateHarnessFinding,
  CreateHarnessRun,
  CreateVerificationRun,
  UpdateHarnessFinding,
  UpdateFeature,
  UpdateRepoLock,
  UpsertRepoLock,
} from "@paperclipai/shared";

const AUTO_MERGE_READY_STATES = new Set(["merge_ready"]);
const AUTO_MERGE_BLOCKING_REPO_STATES = new Set([
  "queued_repo_gate",
  "locked_cto",
  "blocked_needs_benjamin",
]);
const AUTO_MERGE_SENSITIVE_TERMS = [
  "dashboard",
  "auth",
  "sso",
  "rls",
  "migration",
  "secret",
  "credential",
  "provider",
  "infra",
  "production",
  "deploy",
  "release",
  "packaging",
  "stripe",
  "billing",
  "supabase",
];

type IssueRow = typeof issues.$inferSelect;
type RepoLockRow = typeof repoLocks.$inferSelect;
type VerificationRunRow = typeof verificationRuns.$inferSelect;

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

function isOpenIssueStatus(status: string) {
  return status !== "done" && status !== "cancelled";
}

function hasSensitiveAutoMergeSurface(issue: IssueRow, repo: string | null) {
  const surfaces = Array.isArray(issue.surfaces) ? issue.surfaces : [];
  const haystack = [
    repo,
    issue.title,
    issue.description,
    ...surfaces,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return AUTO_MERGE_SENSITIVE_TERMS.some((term) => haystack.includes(term));
}

function newestVerificationDate(runs: VerificationRunRow[]) {
  let newest: Date | null = null;
  for (const run of runs) {
    const candidate = run.finishedAt ?? run.startedAt ?? run.createdAt ?? null;
    if (!candidate) continue;
    if (!newest || candidate.getTime() > newest.getTime()) newest = candidate;
  }
  return newest;
}

function latestVerificationByType(runs: VerificationRunRow[]) {
  const latest = new Map<string, VerificationRunRow>();
  const sorted = [...runs].sort((a, b) => {
    const aTime = (a.finishedAt ?? a.startedAt ?? a.createdAt).getTime();
    const bTime = (b.finishedAt ?? b.startedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
  for (const run of sorted) {
    if (!latest.has(run.type)) latest.set(run.type, run);
  }
  return latest;
}

function pickRepo(issue: IssueRow, lock: RepoLockRow | null): string | null {
  if (lock?.repo) return lock.repo;
  const surfaces = Array.isArray(issue.surfaces) ? issue.surfaces.filter((surface) => surface !== "external") : [];
  return surfaces[0] ?? null;
}

function pickBranch(lock: RepoLockRow | null, runs: VerificationRunRow[]) {
  return lock?.branch ?? runs.find((run) => run.branch)?.branch ?? null;
}

function pickPrUrl(lock: RepoLockRow | null, runs: VerificationRunRow[]) {
  return lock?.prUrl ?? runs.find((run) => run.prUrl)?.prUrl ?? null;
}

export function buildAutoMergeCandidates(
  issueRows: IssueRow[],
  lockRows: RepoLockRow[],
  verificationRows: VerificationRunRow[],
): AutoMergeCandidate[] {
  const locksById = new Map(lockRows.map((lock) => [lock.id, lock]));
  const locksByIssueId = new Map(lockRows.filter((lock) => lock.activeIssueId).map((lock) => [lock.activeIssueId!, lock]));
  const verificationByIssueId = new Map<string, VerificationRunRow[]>();
  for (const run of verificationRows) {
    if (!run.issueId) continue;
    const list = verificationByIssueId.get(run.issueId) ?? [];
    list.push(run);
    verificationByIssueId.set(run.issueId, list);
  }

  return issueRows
    .filter((issue) =>
      isOpenIssueStatus(issue.status) &&
      (
        issue.autoMergeEligible ||
        issue.deliveryState === "merge_ready" ||
        Boolean(issue.repoLockId) ||
        locksByIssueId.has(issue.id)
      ),
    )
    .map((issue) => {
      const lock = (issue.repoLockId ? locksById.get(issue.repoLockId) : null) ?? locksByIssueId.get(issue.id) ?? null;
      const runs = verificationByIssueId.get(issue.id) ?? [];
      const latestByType = latestVerificationByType(runs);
      const latestRuns = [...latestByType.values()];
      const failedRuns = latestRuns.filter((run) => run.status !== "pass");
      const passedRuns = latestRuns.filter((run) => run.status === "pass");
      const securityRun = latestByType.get("security") ?? null;
      const repo = pickRepo(issue, lock);
      const branch = pickBranch(lock, runs);
      const prUrl = pickPrUrl(lock, runs);
      const reasons: string[] = [];

      if (!isOpenIssueStatus(issue.status)) reasons.push("issue_closed");
      if (issue.benjaminRequired) reasons.push("benjamin_required");
      if (repo === null) reasons.push("missing_repo");
      if (repo === "dashboard" || (Array.isArray(issue.surfaces) && issue.surfaces.includes("dashboard"))) {
        reasons.push("dashboard_requires_benjamin");
      }
      if (hasSensitiveAutoMergeSurface(issue, repo)) reasons.push("sensitive_surface");
      if (!AUTO_MERGE_READY_STATES.has(issue.deliveryState)) reasons.push("delivery_state_not_merge_ready");
      if (!prUrl) reasons.push("missing_pr_url");
      if (lock && AUTO_MERGE_BLOCKING_REPO_STATES.has(lock.state)) reasons.push("repo_lock_not_ready");
      if (lock?.blockerType) reasons.push(`repo_blocker:${lock.blockerType}`);
      if (issue.blockerType) reasons.push(`issue_blocker:${issue.blockerType}`);
      if (failedRuns.length > 0) reasons.push("verification_not_green");
      if (passedRuns.length === 0) reasons.push("verification_missing");
      if (securityRun && securityRun.status !== "pass") reasons.push("security_not_green");

      const uniqueReasons = [...new Set(reasons)];
      return {
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status,
        deliveryState: issue.deliveryState as AutoMergeCandidate["deliveryState"],
        repo,
        branch,
        prUrl,
        repoLockId: lock?.id ?? issue.repoLockId ?? null,
        repoLockState: (lock?.state as AutoMergeCandidate["repoLockState"]) ?? null,
        blockerType: (issue.blockerType as AutoMergeCandidate["blockerType"]) ?? (lock?.blockerType as AutoMergeCandidate["blockerType"]) ?? null,
        benjaminRequired: issue.benjaminRequired,
        storedAutoMergeEligible: issue.autoMergeEligible,
        eligible: uniqueReasons.length === 0,
        reasons: uniqueReasons,
        passedVerificationCount: passedRuns.length,
        failedVerificationCount: failedRuns.length,
        latestVerificationAt: newestVerificationDate(runs),
        securityStatus: securityRun ? (securityRun.status as AutoMergeCandidate["securityStatus"]) : "not_recorded",
        nextAction: uniqueReasons.length === 0
          ? "Ready for gated auto-merge outside dashboard."
          : `Resolve: ${uniqueReasons.slice(0, 3).join(", ")}`,
      };
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.storedAutoMergeEligible !== b.storedAutoMergeEligible) return a.storedAutoMergeEligible ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}

export function deliveryControlService(db: Db) {
  function listRepoLocks(companyId: string) {
    return db
      .select()
      .from(repoLocks)
      .where(eq(repoLocks.companyId, companyId))
      .orderBy(repoLocks.repo);
  }

  function listFeatures(companyId: string) {
    return db
      .select()
      .from(features)
      .where(eq(features.companyId, companyId))
      .orderBy(features.priorityRank, desc(features.updatedAt), features.title);
  }

  function getFeature(id: string) {
    return db.select().from(features).where(eq(features.id, id)).then((rows) => rows[0] ?? null);
  }

  async function createFeature(companyId: string, input: CreateFeature) {
    return db
      .insert(features)
      .values({
        companyId,
        featureId: input.featureId,
        title: input.title,
        sourceTeam: input.sourceTeam,
        intakeStatus: input.intakeStatus,
        priorityRank: input.priorityRank,
        pmBrief: input.pmBrief ?? {},
        whyNow: input.whyNow,
        impactEstimate: input.impactEstimate,
        effortEstimate: input.effortEstimate,
        riskLevel: input.riskLevel,
        productArea: input.productArea,
        repo: input.repo,
        rootIssueId: input.rootIssueId,
        deliveryState: input.deliveryState,
        requiredEvidence: input.requiredEvidence ?? [],
        terminalEvidence: input.terminalEvidence,
        nextAction: input.nextAction,
        ownerAgentId: input.ownerAgentId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function updateFeature(id: string, input: UpdateFeature, changedBy: string | null = null) {
    const existing = await db.select().from(features).where(eq(features.id, id)).then((rows) => rows[0] ?? null);
    if (!existing) return null;
    const patch = cleanUndefined({
      title: input.title,
      sourceTeam: input.sourceTeam,
      intakeStatus: input.intakeStatus,
      priorityRank: input.priorityRank,
      pmBrief: input.pmBrief,
      whyNow: input.whyNow,
      impactEstimate: input.impactEstimate,
      effortEstimate: input.effortEstimate,
      riskLevel: input.riskLevel,
      productArea: input.productArea,
      repo: input.repo,
      rootIssueId: input.rootIssueId,
      deliveryState: input.deliveryState,
      requiredEvidence: input.requiredEvidence,
      terminalEvidence: input.terminalEvidence,
      nextAction: input.nextAction,
      ownerAgentId: input.ownerAgentId,
      updatedAt: new Date(),
    });
    const updated = await db
      .update(features)
      .set(patch)
      .where(eq(features.id, id))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (updated && (input.priorityRank !== undefined || input.intakeStatus !== undefined)) {
      await db.insert(featurePriorityEvents).values({
        companyId: existing.companyId,
        featureId: existing.id,
        fromRank: existing.priorityRank,
        toRank: input.priorityRank ?? existing.priorityRank,
        changedBy,
        previousIntakeStatus: existing.intakeStatus,
        newIntakeStatus: input.intakeStatus ?? existing.intakeStatus,
      });
    }
    return updated;
  }

  async function listAutoMergeCandidates(companyId: string): Promise<AutoMergeCandidate[]> {
    const [issueRows, lockRows, verificationRows] = await Promise.all([
      db
        .select()
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .orderBy(desc(issues.updatedAt)),
      db
        .select()
        .from(repoLocks)
        .where(eq(repoLocks.companyId, companyId)),
      db
        .select()
        .from(verificationRuns)
        .where(eq(verificationRuns.companyId, companyId))
        .orderBy(desc(verificationRuns.finishedAt), desc(verificationRuns.createdAt)),
    ]);

    return buildAutoMergeCandidates(issueRows, lockRows, verificationRows);
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
    listFeatures,
    getFeature,
    createFeature,
    updateFeature,
    listAgentThroughput,
    listAutoMergeCandidates,
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
