import { readFile } from "node:fs/promises";
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
  testCases,
  verificationRuns,
} from "@paperclipai/db";
import type {
  AutoMergeCandidate,
  CreateFeature,
  CreateHarnessFinding,
  CreateHarnessRun,
  CreateVerificationRun,
  TestCase,
  TestCaseBackfillSummary,
  UpdateHarnessFinding,
  UpdateFeature,
  UpdateRepoLock,
  UpsertRepoLock,
  UpsertTestCase,
} from "@paperclipai/shared";

const AUTO_MERGE_READY_STATES = new Set(["merge_ready"]);
const AUTO_MERGE_BLOCKING_REPO_STATES = new Set([
  "queued_repo_gate",
  "locked_cto",
  "blocked_needs_benjamin",
]);
const VERIFICATION_TAIL_DELIVERY_STATES = new Set(["merged", "target_verifying"]);
const TERMINAL_EVIDENCE_DELIVERY_STATES = new Set(["merged_verified", "live_verified", "waived_by_benjamin"]);
const TARGET_CHECK_STALE_MINUTES = 30;
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
type FeatureRow = typeof features.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type RepoLockRow = typeof repoLocks.$inferSelect;
type VerificationRunRow = typeof verificationRuns.$inferSelect;
type TestCaseRow = typeof testCases.$inferSelect;

const FEATURE_BACKFILL_AGENT_NAMES = new Set(["Dev Feature", "PM Feature"]);
const FEATURE_BACKFILL_PRODUCT_PREFIXES = ["[desktop]", "[dashboard]", "[cli]", "[feature]"];
const FEATURE_BACKFILL_EXCLUDED_TERMS = [
  "[cto]",
  "[security",
  "[process",
  "[harness",
  "anti-recurrence",
  "approval",
  "credential",
  "dispatcher",
  "false-done",
  "harness",
  "preflight",
  "repo steward",
  "routine",
  "security review",
  "token",
  "worktree",
];

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

function cleanCell(value: string | undefined): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/`/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, target: string, label: string) => label || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return cleanCell(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "test";
}

function parseMarkdownTableRows(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, -1).split("|").map(cleanCell));
}

function repoFromSurface(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("dashboard")) return "dashboard";
  if (normalized.includes("app") || normalized.includes("cli")) return "app_cli";
  if (normalized.includes("desktop")) return "desktop";
  if (normalized.includes("inference")) return "inference";
  if (normalized.includes("research") || normalized.includes("harness")) return "souver_research";
  if (normalized.includes("doc") || normalized.includes("ops") || normalized.includes("paperclip")) return "paperclip";
  return null;
}

function typeFromText(value: string): UpsertTestCase["type"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("security") || normalized.includes("pentest") || normalized.includes("redteam")) return "security";
  if (normalized.includes("visible")) return "visible_e2e";
  if (normalized.includes("harness") || normalized.includes("terminal-bench") || normalized.includes("baseline") || normalized.includes("experiment")) return "harness";
  if (normalized.includes("e2e") || normalized.includes("playwright") || normalized.includes("smoke")) return "e2e";
  if (normalized.includes("integration") || normalized.includes("rls")) return "integration";
  if (normalized.includes("manual")) return "manual_review";
  return "unit";
}

function triggerFromText(value: string): UpsertTestCase["trigger"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("nightly")) return "nightly";
  if (normalized.includes("weekly")) return "weekly";
  if (normalized.includes("daily")) return "daily";
  if (normalized.includes("release")) return "release";
  if (normalized.includes("delivery")) return "per_delivery";
  if (normalized.includes("pr") || normalized.includes("merge")) return "per_pr";
  return "manual";
}

function caseStatusFromText(value: string): UpsertTestCase["status"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("flaky")) return "flaky";
  if (normalized.includes("blocked") || normalized.includes("finding_open")) return "blocked";
  if (normalized.includes("missing") || normalized.includes("not_started") || normalized.includes("todo")) return "missing";
  if (normalized.includes("retired")) return "retired";
  if (normalized.includes("active") || normalized.includes("passed") || normalized.includes("automated") || normalized.includes("documented")) return "active";
  return "designed";
}

function lastStatusFromText(status: string, lastRun: string): UpsertTestCase["lastStatus"] {
  const normalized = `${status} ${lastRun}`.toLowerCase();
  if (normalized.includes("fail")) return "fail";
  if (normalized.includes("pass") || normalized.includes("passed") || normalized.includes("vert")) return "pass";
  if (normalized.includes("flaky")) return "flaky";
  if (normalized.includes("skipped")) return "skipped";
  if (normalized.includes("blocked") || normalized.includes("finding_open")) return "blocked";
  if (normalized.includes("missing") || normalized.includes("not_started") || normalized.includes("not_run") || normalized.includes("todo")) return "missing";
  if (normalized.includes("stale")) return "stale";
  if (lastRun.trim().length > 0) return "inconclusive";
  return null;
}

function firstIsoDate(value: string): string | null {
  return value.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function splitRefs(value: string): string[] {
  return [...new Set((value.match(/\b[A-Z]{2,10}-\d+\b/g) ?? []).map((ref) => ref.toUpperCase()))];
}

function buildRegressionLedgerCases(content: string, sourcePath: string): UpsertTestCase[] {
  const rows = parseMarkdownTableRows(content);
  const headerIndex = rows.findIndex((row) => row[0] === "ID" && row.includes("Commande"));
  if (headerIndex < 0) return [];
  return rows.slice(headerIndex + 1).filter((row) => row.length >= 9).map((row) => {
    const [stableKey, surface, risk, command, trigger, owner, source, status, lastRun] = row;
    const lastDate = firstIsoDate(lastRun);
    const lastStatus = lastStatusFromText(status, lastRun);
    return {
      stableKey: slugify(stableKey),
      title: cleanCell(stableKey),
      repo: repoFromSurface(surface),
      productArea: repoFromSurface(surface) ?? "souver",
      featureIds: splitRefs(source),
      issueIds: splitRefs(`${source} ${lastRun}`),
      type: typeFromText(`${stableKey} ${command} ${risk}`),
      trigger: triggerFromText(trigger),
      command: command || null,
      owner: owner || null,
      environment: command.toLowerCase().includes("visible") ? "visible local" : "local",
      riskCovered: risk || null,
      requiredForDelivery: trigger.toLowerCase().includes("delivery") || trigger.toLowerCase().includes("pr"),
      visibleRunnable: `${stableKey} ${command}`.toLowerCase().includes("visible"),
      status: caseStatusFromText(status),
      source: "regression_ledger",
      sourcePath,
      lastStatus,
      lastRunAt: lastDate,
      artifactRefs: splitRefs(`${source} ${lastRun}`),
      nextAction: lastStatus === "pass" ? null : lastRun || "Run required before this test can be terminal evidence.",
    };
  });
}

function buildCahierCases(content: string, sourcePath: string, repo: string): UpsertTestCase[] {
  const rows = parseMarkdownTableRows(content);
  const commandHeaderIndex = rows.findIndex((row) => row[0] === "Niveau" && row.includes("Commande"));
  const cases: UpsertTestCase[] = [];
  if (commandHeaderIndex >= 0) {
    for (const row of rows.slice(commandHeaderIndex + 1)) {
      if (row.length < 4 || row[0] === "Suite" || row[0] === "Fonctionnalite livree" || row[0] === "Gap") break;
      const [level, command, trigger, evidence] = row;
      cases.push({
        stableKey: `${repo}-validation-${slugify(level)}`,
        title: `${repo} ${level}`,
        repo,
        productArea: repo,
        type: typeFromText(`${level} ${command}`),
        trigger: triggerFromText(trigger),
        command: command || null,
        owner: "Test Architect",
        environment: command.toLowerCase().includes("visible") ? "visible local" : "local",
        riskCovered: evidence ? `Produces ${evidence}` : null,
        requiredForDelivery: triggerFromText(trigger) === "per_pr" || triggerFromText(trigger) === "per_delivery",
        visibleRunnable: command.toLowerCase().includes("visible"),
        status: "designed",
        source: "cahier",
        sourcePath,
        lastStatus: "missing",
        nextAction: "Cahier command is designed; attach a real run before using as terminal evidence.",
      });
    }
  }
  const gapHeaderIndex = rows.findIndex((row) => row[0] === "Gap" && row.includes("Suite attendue"));
  if (gapHeaderIndex >= 0) {
    for (const row of rows.slice(gapHeaderIndex + 1)) {
      if (row.length < 3 || row[0] === "Source") break;
      const [gap, impact, expected] = row;
      cases.push({
        stableKey: `${repo}-gap-${slugify(gap)}`,
        title: gap,
        repo,
        productArea: repo,
        type: typeFromText(expected),
        trigger: "manual",
        command: expected || null,
        owner: "Test Architect",
        riskCovered: impact || null,
        requiredForDelivery: false,
        visibleRunnable: expected.toLowerCase().includes("visible"),
        status: "missing",
        source: "cahier",
        sourcePath,
        lastStatus: "missing",
        nextAction: expected || "Define and run the missing suite.",
      });
    }
  }
  return cases;
}

function buildSecurityCatalogCases(content: string, sourcePath: string): UpsertTestCase[] {
  const rows = parseMarkdownTableRows(content);
  const headerIndex = rows.findIndex((row) => row[0] === "ID" && row.includes("Commande / méthode"));
  if (headerIndex < 0) return [];
  return rows.slice(headerIndex + 1).filter((row) => row.length >= 13).map((row) => {
    const [id, title, domain, surface, feature, mode, criticality, status, lastRun, verdict, owner, evidence, command] = row;
    const lastDate = firstIsoDate(lastRun);
    return {
      stableKey: slugify(id),
      title: `${id} ${title}`,
      repo: repoFromSurface(surface),
      productArea: surface || "security",
      featureIds: feature ? [feature] : [],
      issueIds: splitRefs(`${feature} ${evidence}`),
      type: "security",
      trigger: mode.toLowerCase().includes("unit") ? "per_pr" : "manual",
      command: command || null,
      owner: owner || null,
      environment: mode || null,
      riskCovered: `${domain}${criticality ? ` (${criticality})` : ""}`,
      requiredForDelivery: criticality.toLowerCase() === "critical",
      visibleRunnable: false,
      status: caseStatusFromText(status),
      source: "security_catalog",
      sourcePath,
      lastStatus: lastStatusFromText(verdict, lastRun),
      lastRunAt: lastDate,
      artifactRefs: evidence ? [evidence] : [],
      nextAction: verdict === "pass" ? null : command || owner || "Security run required.",
    };
  });
}

function buildSecurityMatrixCases(content: string, sourcePath: string): UpsertTestCase[] {
  const rows = parseMarkdownTableRows(content);
  const headerIndex = rows.findIndex((row) => row[0] === "ID" && row.includes("Risque"));
  if (headerIndex < 0) return [];
  return rows.slice(headerIndex + 1).filter((row) => row.length >= 9).map((row) => {
    const [id, surface, domain, risk, criticality, status, owner, lastRun, evidence, notes] = row;
    const lastDate = firstIsoDate(lastRun);
    return {
      stableKey: slugify(id),
      title: `${id} ${surface} ${domain}`,
      repo: repoFromSurface(surface),
      productArea: surface || "security",
      type: "security",
      trigger: "manual",
      command: notes || null,
      owner: owner || null,
      environment: "security coverage matrix",
      riskCovered: risk || null,
      requiredForDelivery: criticality.toLowerCase() === "critical",
      visibleRunnable: false,
      status: caseStatusFromText(status),
      source: "security_matrix",
      sourcePath,
      lastStatus: lastStatusFromText(status, lastRun),
      lastRunAt: lastDate,
      artifactRefs: evidence ? [evidence] : [],
      nextAction: status.toLowerCase().includes("automated") ? null : notes || owner || "Security coverage requires execution.",
    };
  });
}

async function readOptionalFile(path: string) {
  try {
    return { path, content: await readFile(path, "utf8") };
  } catch {
    return { path, content: null };
  }
}

async function buildSouverTestCaseBackfillCandidates(): Promise<{
  cases: UpsertTestCase[];
  sourcesRead: string[];
  sourcesMissing: string[];
}> {
  const root = "/Users/openclaw/Developer/souver";
  const sourceSpecs = [
    { path: `${root}/doc/04-agents/testing/regression-ledger.md`, kind: "regression" as const },
    { path: `${root}/doc/04-agents/testing/cahiers/README.md`, kind: "cahier" as const, repo: "parent_kb_ops" },
    { path: `${root}/doc/04-agents/testing/cahiers/dashboard.md`, kind: "cahier" as const, repo: "dashboard" },
    { path: `${root}/doc/04-agents/testing/cahiers/app-cli.md`, kind: "cahier" as const, repo: "app_cli" },
    { path: `${root}/doc/04-agents/testing/cahiers/desktop.md`, kind: "cahier" as const, repo: "desktop" },
    { path: `${root}/doc/04-agents/testing/cahiers/inference.md`, kind: "cahier" as const, repo: "inference" },
    { path: `${root}/doc/04-agents/testing/cahiers/harness.md`, kind: "cahier" as const, repo: "souver_research" },
    { path: `${root}/doc/04-agents/testing/security-test-catalog.md`, kind: "securityCatalog" as const },
    { path: `${root}/doc/04-agents/testing/security-coverage-matrix.md`, kind: "securityMatrix" as const },
  ];
  const reads = await Promise.all(sourceSpecs.map((source) => readOptionalFile(source.path)));
  const sourcesRead: string[] = [];
  const sourcesMissing: string[] = [];
  const cases: UpsertTestCase[] = [];
  for (let index = 0; index < sourceSpecs.length; index += 1) {
    const source = sourceSpecs[index]!;
    const read = reads[index]!;
    if (!read.content) {
      sourcesMissing.push(source.path);
      continue;
    }
    sourcesRead.push(source.path);
    if (source.kind === "regression") cases.push(...buildRegressionLedgerCases(read.content, source.path));
    if (source.kind === "cahier") cases.push(...buildCahierCases(read.content, source.path, source.repo));
    if (source.kind === "securityCatalog") cases.push(...buildSecurityCatalogCases(read.content, source.path));
    if (source.kind === "securityMatrix") cases.push(...buildSecurityMatrixCases(read.content, source.path));
  }
  return { cases, sourcesRead, sourcesMissing };
}

function isOpenIssueStatus(status: string) {
  return status !== "done" && status !== "cancelled";
}

function primarySurface(issue: IssueRow): string | null {
  const surfaces = Array.isArray(issue.surfaces) ? issue.surfaces : [];
  return surfaces.find((surface) => typeof surface === "string" && surface.trim().length > 0) ?? null;
}

function featureStatusFromIssue(issue: IssueRow): CreateFeature["intakeStatus"] {
  if (issue.status === "in_progress" || issue.status === "in_review") return "in_delivery";
  if (issue.status === "blocked") return "selected";
  if (issue.status === "todo") return "queued";
  return "ready_for_priority";
}

function featureIdFromIssue(issue: IssueRow): string {
  if (issue.identifier) return issue.identifier;
  if (issue.issueNumber) return `ISSUE-${issue.issueNumber}`;
  return `ISSUE-${issue.id.slice(0, 8)}`;
}

function isFeatureBackfillIssue(issue: IssueRow, agentsById: Map<string, AgentRow>) {
  if (!isOpenIssueStatus(issue.status) || issue.hiddenAt != null) return false;
  if (issue.category === "feature") return true;

  const haystack = `${issue.title ?? ""}\n${issue.description ?? ""}`.toLowerCase();
  if (FEATURE_BACKFILL_EXCLUDED_TERMS.some((term) => haystack.includes(term))) return false;

  const assigneeName = issue.assigneeAgentId ? agentsById.get(issue.assigneeAgentId)?.name : null;
  if (assigneeName && FEATURE_BACKFILL_AGENT_NAMES.has(assigneeName)) return true;
  if (FEATURE_BACKFILL_PRODUCT_PREFIXES.some((prefix) => haystack.startsWith(prefix))) return true;
  return /\bfeature\b/.test(haystack);
}

export function buildFeatureBackfillCandidates(
  issueRows: IssueRow[],
  existingFeatureRows: FeatureRow[],
  agentRows: AgentRow[] = [],
): CreateFeature[] {
  const agentsById = new Map(agentRows.map((agent) => [agent.id, agent]));
  const existingRootIssueIds = new Set(existingFeatureRows.map((feature) => feature.rootIssueId).filter(Boolean));
  const existingFeatureIds = new Set(existingFeatureRows.map((feature) => feature.featureId));
  const maxRank = existingFeatureRows.reduce((max, feature) => Math.max(max, feature.priorityRank ?? 0), 0);

  return issueRows
    .filter((issue) => isFeatureBackfillIssue(issue, agentsById))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .reduce<CreateFeature[]>((candidates, issue) => {
      const featureId = featureIdFromIssue(issue);
      if (existingRootIssueIds.has(issue.id) || existingFeatureIds.has(featureId)) return candidates;
      const repo = primarySurface(issue);
      const rank = maxRank + candidates.length + 1;
      candidates.push({
        featureId,
        title: issue.title,
        sourceTeam: "pm",
        intakeStatus: featureStatusFromIssue(issue),
        priorityRank: rank,
        pmBrief: {
          sourceIssueId: issue.id,
          sourceIssueIdentifier: issue.identifier,
          sourceIssueStatus: issue.status,
        },
        whyNow: issue.nextAction ?? "Backfilled from an existing Feature issue.",
        impactEstimate: issue.priority,
        effortEstimate: null,
        riskLevel: "medium",
        productArea: repo ?? "paperclip",
        repo,
        rootIssueId: issue.id,
        deliveryState: issue.deliveryState as CreateFeature["deliveryState"],
        requiredEvidence: [],
        terminalEvidence: issue.terminalEvidence,
        nextAction: issue.nextAction ?? "PM/CTO prioritizes this feature before delivery starts.",
        ownerAgentId: issue.assigneeAgentId,
      });
      existingFeatureIds.add(featureId);
      return candidates;
    }, []);
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

function hasTerminalEvidence(issue: IssueRow) {
  return Boolean(issue.terminalEvidence && typeof issue.terminalEvidence === "object" && Object.keys(issue.terminalEvidence).length > 0);
}

function isVerificationTailIssue(issue: IssueRow) {
  return VERIFICATION_TAIL_DELIVERY_STATES.has(issue.deliveryState) && !hasTerminalEvidence(issue);
}

function targetCheckAgeMinutes(runs: VerificationRunRow[], now = new Date()) {
  const pending = runs
    .filter((run) => run.status === "in_progress" || (run.startedAt && !run.finishedAt))
    .sort((a, b) => (b.startedAt ?? b.createdAt).getTime() - (a.startedAt ?? a.createdAt).getTime())[0];
  if (!pending) return null;
  const startedAt = pending.startedAt ?? pending.createdAt;
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
}

function classifyVerificationTail(
  issue: IssueRow,
  repo: string | null,
  runs: VerificationRunRow[],
  now = new Date(),
): AutoMergeCandidate["verificationTail"] {
  const latestRuns = [...latestVerificationByType(runs).values()];
  if (hasTerminalEvidence(issue) || TERMINAL_EVIDENCE_DELIVERY_STATES.has(issue.deliveryState)) {
    return "terminal_evidence_written" as const;
  }
  if (!isVerificationTailIssue(issue)) return "none" as const;
  if (latestRuns.some((run) => run.status === "fail" || run.status === "blocked")) return "test_gate" as const;
  const ageMinutes = targetCheckAgeMinutes(latestRuns, now);
  if (ageMinutes !== null && ageMinutes >= TARGET_CHECK_STALE_MINUTES) {
    return hasSensitiveAutoMergeSurface(issue, repo) ? "waiver_candidate" : "tail_waiting";
  }
  return "pending" as const;
}

function classifyImplementationSlot(
  issue: IssueRow,
  repo: string | null,
  lock: RepoLockRow | null,
  tailState: AutoMergeCandidate["verificationTail"],
): AutoMergeCandidate["implementationSlot"] {
  if (!isVerificationTailIssue(issue)) return lock?.state === "free" ? "released" : "held";
  if (tailState === "test_gate") return "held";
  if (repo === "dashboard" || hasSensitiveAutoMergeSurface(issue, repo)) return "held";
  return "released";
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
        VERIFICATION_TAIL_DELIVERY_STATES.has(issue.deliveryState) ||
        Boolean(issue.repoLockId) ||
        locksByIssueId.has(issue.id)
      ),
    )
    .map((issue) => {
      const lock = (issue.repoLockId ? locksById.get(issue.repoLockId) : null) ?? locksByIssueId.get(issue.id) ?? null;
      const runs = verificationByIssueId.get(issue.id) ?? [];
      const latestByType = latestVerificationByType(runs);
      const latestRuns = [...latestByType.values()];
      const failedRuns = latestRuns.filter((run) => run.status === "fail" || run.status === "blocked");
      const inconclusiveRuns = latestRuns.filter((run) => run.status === "inconclusive" || run.status === "in_progress");
      const passedRuns = latestRuns.filter((run) => run.status === "pass");
      const securityRun = latestByType.get("security") ?? null;
      const repo = pickRepo(issue, lock);
      const branch = pickBranch(lock, runs);
      const prUrl = pickPrUrl(lock, runs);
      const verificationTail = classifyVerificationTail(issue, repo, runs);
      const implementationSlot = classifyImplementationSlot(issue, repo, lock, verificationTail);
      const checkAgeMinutes = targetCheckAgeMinutes(latestRuns);
      const reasons: string[] = [];

      if (!isOpenIssueStatus(issue.status)) reasons.push("issue_closed");
      if (issue.benjaminRequired) reasons.push("benjamin_required");
      if (repo === null) reasons.push("missing_repo");
      if (repo === "dashboard" || (Array.isArray(issue.surfaces) && issue.surfaces.includes("dashboard"))) {
        reasons.push("dashboard_requires_benjamin");
      }
      if (hasSensitiveAutoMergeSurface(issue, repo)) reasons.push("sensitive_surface");
      if (!AUTO_MERGE_READY_STATES.has(issue.deliveryState)) {
        reasons.push(isVerificationTailIssue(issue) ? "verification_tail_pending" : "delivery_state_not_merge_ready");
      }
      if (!prUrl) reasons.push("missing_pr_url");
      if (lock && AUTO_MERGE_BLOCKING_REPO_STATES.has(lock.state)) reasons.push("repo_lock_not_ready");
      if (lock?.blockerType) reasons.push(`repo_blocker:${lock.blockerType}`);
      if (issue.blockerType && !["tail_waiting", "waiver_candidate"].includes(issue.blockerType)) {
        reasons.push(`issue_blocker:${issue.blockerType}`);
      }
      if (failedRuns.length > 0) reasons.push("verification_not_green");
      if (inconclusiveRuns.length > 0 && !isVerificationTailIssue(issue)) reasons.push("verification_not_green");
      if (passedRuns.length === 0 && !isVerificationTailIssue(issue)) reasons.push("verification_missing");
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
        implementationSlot,
        verificationTail,
        targetCheckAgeMinutes: checkAgeMinutes,
        benjaminRequired: issue.benjaminRequired,
        storedAutoMergeEligible: issue.autoMergeEligible,
        eligible: uniqueReasons.length === 0,
        reasons: uniqueReasons,
        passedVerificationCount: passedRuns.length,
        failedVerificationCount: failedRuns.length,
        latestVerificationAt: newestVerificationDate(runs),
        securityStatus: securityRun ? (securityRun.status as AutoMergeCandidate["securityStatus"]) : "not_recorded",
        nextAction: verificationTail !== "none"
          ? `Implementation slot ${implementationSlot}; verification tail ${verificationTail}.`
          : uniqueReasons.length === 0
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

  async function backfillFeaturesFromIssues(companyId: string) {
    const [issueRows, existingFeatureRows, agentRows] = await Promise.all([
      db
        .select()
        .from(issues)
        .where(and(
          eq(issues.companyId, companyId),
          sql`${issues.hiddenAt} is null`,
          sql`${issues.status} not in ('done', 'cancelled')`,
        )),
      db.select().from(features).where(eq(features.companyId, companyId)),
      db.select().from(agents).where(eq(agents.companyId, companyId)),
    ]);
    const candidates = buildFeatureBackfillCandidates(issueRows, existingFeatureRows, agentRows);
    if (candidates.length === 0) {
      return { created: 0, skipped: issueRows.length, features: [] };
    }

    const created = await db
      .insert(features)
      .values(candidates.map((candidate) => ({ companyId, ...candidate })))
      .onConflictDoNothing({
        target: [features.companyId, features.featureId],
      })
      .returning();

    return {
      created: created.length,
      skipped: issueRows.length - created.length,
      features: created,
    };
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

  async function listTestCases(companyId: string): Promise<TestCase[]> {
    const rows = await db
      .select()
      .from(testCases)
      .where(eq(testCases.companyId, companyId))
      .orderBy(testCases.repo, testCases.type, testCases.stableKey);
    return rows as unknown as TestCase[];
  }

  async function upsertTestCases(companyId: string, inputs: UpsertTestCase[]) {
    if (inputs.length === 0) return { created: 0, updated: 0, tests: [] as TestCaseRow[] };
    const existingRows = await db
      .select({ stableKey: testCases.stableKey })
      .from(testCases)
      .where(eq(testCases.companyId, companyId));
    const existingKeys = new Set(existingRows.map((row) => row.stableKey));
    const now = new Date();
    const rows = await db
      .insert(testCases)
      .values(inputs.map((input) => ({
        companyId,
        stableKey: input.stableKey,
        title: input.title,
        repo: input.repo,
        productArea: input.productArea,
        featureIds: input.featureIds ?? [],
        issueIds: input.issueIds ?? [],
        type: input.type,
        trigger: input.trigger,
        command: input.command,
        owner: input.owner,
        environment: input.environment,
        riskCovered: input.riskCovered,
        requiredForDelivery: input.requiredForDelivery ?? false,
        visibleRunnable: input.visibleRunnable ?? false,
        expectedDurationSec: input.expectedDurationSec,
        status: input.status,
        source: input.source,
        sourcePath: input.sourcePath,
        lastRunId: input.lastRunId,
        lastStatus: input.lastStatus,
        lastRunAt: parseDate(input.lastRunAt) ?? null,
        lastCommitSha: input.lastCommitSha,
        lastBranch: input.lastBranch,
        lastPrUrl: input.lastPrUrl,
        artifactRefs: input.artifactRefs ?? [],
        gapIssueId: input.gapIssueId,
        flakyReason: input.flakyReason,
        waiver: input.waiver,
        nextAction: input.nextAction,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: [testCases.companyId, testCases.stableKey],
        set: {
          title: sql`excluded.title`,
          repo: sql`excluded.repo`,
          productArea: sql`excluded.product_area`,
          featureIds: sql`excluded.feature_ids`,
          issueIds: sql`excluded.issue_ids`,
          type: sql`excluded.type`,
          trigger: sql`excluded.trigger`,
          command: sql`excluded.command`,
          owner: sql`excluded.owner`,
          environment: sql`excluded.environment`,
          riskCovered: sql`excluded.risk_covered`,
          requiredForDelivery: sql`excluded.required_for_delivery`,
          visibleRunnable: sql`excluded.visible_runnable`,
          expectedDurationSec: sql`excluded.expected_duration_sec`,
          status: sql`excluded.status`,
          source: sql`excluded.source`,
          sourcePath: sql`excluded.source_path`,
          lastRunId: sql`excluded.last_run_id`,
          lastStatus: sql`excluded.last_status`,
          lastRunAt: sql`excluded.last_run_at`,
          lastCommitSha: sql`excluded.last_commit_sha`,
          lastBranch: sql`excluded.last_branch`,
          lastPrUrl: sql`excluded.last_pr_url`,
          artifactRefs: sql`excluded.artifact_refs`,
          gapIssueId: sql`excluded.gap_issue_id`,
          flakyReason: sql`excluded.flaky_reason`,
          waiver: sql`excluded.waiver`,
          nextAction: sql`excluded.next_action`,
          updatedAt: now,
        },
      })
      .returning();
    const created = inputs.filter((input) => !existingKeys.has(input.stableKey)).length;
    return { created, updated: inputs.length - created, tests: rows };
  }

  async function backfillSouverTestCases(companyId: string): Promise<TestCaseBackfillSummary> {
    const { cases, sourcesRead, sourcesMissing } = await buildSouverTestCaseBackfillCandidates();
    const uniqueCases = [...new Map(cases.map((testCase) => [testCase.stableKey, testCase])).values()];
    const result = await upsertTestCases(companyId, uniqueCases);
    const tests = await listTestCases(companyId);
    const byRepo: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byLastStatus: Record<string, number> = {};
    for (const testCase of tests) {
      byRepo[testCase.repo ?? "none"] = (byRepo[testCase.repo ?? "none"] ?? 0) + 1;
      byType[testCase.type] = (byType[testCase.type] ?? 0) + 1;
      byLastStatus[testCase.lastStatus ?? "none"] = (byLastStatus[testCase.lastStatus ?? "none"] ?? 0) + 1;
    }
    const gaps = tests
      .filter((testCase) => ["missing", "stale", "flaky", "blocked", "skipped", "inconclusive"].includes(testCase.lastStatus ?? testCase.status))
      .slice(0, 20)
      .map((testCase) => `${testCase.stableKey}: ${testCase.nextAction ?? testCase.lastStatus ?? testCase.status}`);
    return {
      imported: tests.length,
      created: result.created,
      updated: result.updated,
      skipped: Math.max(0, cases.length - uniqueCases.length),
      byRepo,
      byType,
      byLastStatus,
      sourcesRead,
      sourcesMissing,
      gaps,
      tests,
    };
  }

  async function createVerificationRun(companyId: string, input: CreateVerificationRun) {
    const run = await db
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
    if (!run?.issueId) return run;

    const issue = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, run.issueId)))
      .then((rows) => rows[0] ?? null);
    if (!issue || !isVerificationTailIssue(issue)) return run;

    const repo = run.repo ?? primarySurface(issue);
    const staleMinutes = targetCheckAgeMinutes([run]);
    const nextAction =
      run.status === "fail" || run.status === "blocked"
        ? "Target verification failed after merge; fix-forward or record an explicit waiver before same-repo implementation resumes."
        : "Post-merge target verification is still running; keep terminal evidence pending and revisit the tail classification.";
    if (run.status === "fail" || run.status === "blocked") {
      await db
        .update(issues)
        .set({
          blockerType: "test_gate",
          nextAction,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));
      if (repo) {
        await upsertRepoLock(companyId, {
          repo,
          state: "locked_cto",
          activeIssueId: issue.id,
          branch: run.branch,
          prUrl: run.prUrl,
          blockerType: "test_gate",
          nextAction,
        });
      }
    } else if (run.status === "in_progress" && staleMinutes !== null && staleMinutes >= TARGET_CHECK_STALE_MINUTES) {
      const blockerType = hasSensitiveAutoMergeSurface(issue, repo) ? "waiver_candidate" : "tail_waiting";
      await db
        .update(issues)
        .set({
          blockerType,
          nextAction: `${nextAction} Current tail age: ${staleMinutes} minutes.`,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));
      if (repo) {
        await upsertRepoLock(companyId, {
          repo,
          state: blockerType === "tail_waiting" ? "verification_tail" : "locked_cto",
          activeIssueId: issue.id,
          branch: run.branch,
          prUrl: run.prUrl,
          blockerType,
          nextAction: `${nextAction} Current tail age: ${staleMinutes} minutes.`,
        });
      }
    }
    return run;
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
    backfillFeaturesFromIssues,
    updateFeature,
    listAgentThroughput,
    listAutoMergeCandidates,
    getRepoLock,
    upsertRepoLock,
    updateRepoLock,
    listVerificationRuns,
    listTestCases,
    upsertTestCases,
    backfillSouverTestCases,
    createVerificationRun,
    listHarnessRuns,
    createHarnessRun,
    listHarnessFindings,
    getHarnessFinding,
    createHarnessFinding,
    updateHarnessFinding,
  };
}
