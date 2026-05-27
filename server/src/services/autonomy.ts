import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns, issues } from "@paperclipai/db";
import type {
  AutonomyAgentBreakdown,
  AutonomyBucketState,
  AutonomyHeatmapCell,
  AutonomyIncident,
  AutonomyKpis,
  AutonomyPeriodKey,
  AutonomyReport,
} from "@paperclipai/shared";

const PERIOD_HOURS: Record<AutonomyPeriodKey, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
const BUCKET_MINUTES = 60;
const ACTIONABLE_STATUSES = new Set(["todo", "in_progress", "in_review", "blocked"]);
// statuses that represent real (non-backlog) work that was actionable while alive
const WORK_STATUSES = new Set(["todo", "in_progress", "in_review", "blocked", "done"]);
const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface AutonomyRunInput {
  agentId: string;
  status: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  lastUsefulActionAt: Date | string | null;
  error: string | null;
  livenessState: string | null;
}

export interface AutonomyIssueInput {
  status: string;
  benjaminRequired: boolean;
  createdAt: Date | string;
  completedAt: Date | string | null;
  hiddenAt: Date | string | null;
}

export interface AutonomyAgentInput {
  id: string;
  name: string;
}

function overlaps(startMs: number | null, endMs: number | null, t0: number, t1: number): boolean {
  if (startMs == null) return false;
  const end = endMs ?? t1; // open-ended (still running) counts up to bucket end
  return startMs < t1 && end > t0;
}

export function computeAutonomyReport(input: {
  period: AutonomyPeriodKey;
  now: number;
  runs: AutonomyRunInput[];
  issues: AutonomyIssueInput[];
  agents: AutonomyAgentInput[];
  estimatedCostCents?: number | null;
}): AutonomyReport {
  const periodHours = PERIOD_HOURS[input.period];
  const bucketMs = BUCKET_MINUTES * 60 * 1000;
  const periodEnd = input.now;
  const periodStart = periodEnd - periodHours * 60 * 60 * 1000;
  const totalBuckets = Math.round((periodEnd - periodStart) / bucketMs);

  const runMs = input.runs.map((r) => ({
    ...r,
    start: ms(r.startedAt),
    end: ms(r.finishedAt),
    useful: ms(r.lastUsefulActionAt),
  }));
  const issueWindows = input.issues
    .filter((i) => WORK_STATUSES.has(i.status))
    .map((i) => ({
      benjamin: i.benjaminRequired,
      start: ms(i.createdAt),
      end: ms(i.completedAt) ?? periodEnd,
      hidden: ms(i.hiddenAt),
    }))
    .filter((w) => w.hidden == null || w.hidden > periodStart);

  const cells: AutonomyHeatmapCell[] = [];
  let coveredBuckets = 0;
  let incidentBuckets = 0;
  let actionableBuckets = 0;
  let presentBuckets = 0;

  // worst-state precedence for collapsing multiple weeks onto one 24x7 cell
  const precedence: Record<AutonomyBucketState, number> = {
    incident: 5, covered: 4, human_gate: 3, idle_healthy: 2, absent: 1,
  };
  const cellByKey = new Map<string, AutonomyBucketState>();

  for (let b = 0; b < totalBuckets; b++) {
    const t0 = periodStart + b * bucketMs;
    const t1 = t0 + bucketMs;
    const present = runMs.some((r) => overlaps(r.start, r.end, t0, t1));
    const useful = runMs.some((r) => r.useful != null && r.useful >= t0 && r.useful < t1);
    const actionable = issueWindows.some((w) => !w.benjamin && overlaps(w.start, w.end, t0, t1));
    const benjaminWork = issueWindows.some((w) => w.benjamin && overlaps(w.start, w.end, t0, t1));

    let state: AutonomyBucketState;
    if (actionable && useful) state = "covered";
    else if (actionable) state = "incident";
    else if (benjaminWork) state = "human_gate";
    else if (present || useful) state = "idle_healthy";
    else state = "absent";

    if (present) presentBuckets++;
    if (state === "covered") { coveredBuckets++; actionableBuckets++; }
    if (state === "incident") { incidentBuckets++; actionableBuckets++; }

    const d = new Date(t0);
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`;
    const prev = cellByKey.get(key);
    if (prev == null || precedence[state] > precedence[prev]) cellByKey.set(key, state);
  }

  for (const [key, state] of cellByKey) {
    const [dayOfWeek, hour] = key.split("-").map(Number);
    cells.push({ dayOfWeek: dayOfWeek!, hour: hour!, state });
  }
  cells.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);

  const kpis: AutonomyKpis = {
    autonomousCoveragePct: actionableBuckets > 0 ? (coveredBuckets / actionableBuckets) * 100 : null,
    raw247PresencePct: totalBuckets > 0 ? (presentBuckets / totalBuckets) * 100 : 0,
    actionableBuckets,
    coveredBuckets,
    incidentBuckets,
    presentBuckets,
    totalBuckets,
    usefulRuns: runMs.filter((r) => r.useful != null && r.useful >= periodStart && r.useful < periodEnd).length,
    estimatedCostCents: input.estimatedCostCents ?? null,
  };

  const nameById = new Map(input.agents.map((a) => [a.id, a.name]));
  const byAgent = new Map<string, AutonomyAgentBreakdown>();
  for (const r of runMs) {
    const cur = byAgent.get(r.agentId) ?? {
      agentId: r.agentId, name: nameById.get(r.agentId) ?? r.agentId,
      runs: 0, usefulRuns: 0, failedRuns: 0, activeMinutes: 0, lastOutputAt: null as string | null,
    };
    cur.runs++;
    if (r.useful != null) cur.usefulRuns++;
    if (FAILED_RUN_STATUSES.has(r.status) || r.error) cur.failedRuns++;
    if (r.start != null) {
      const end = r.end ?? periodEnd;
      const clampedStart = Math.max(r.start, periodStart);
      const clampedEnd = Math.min(end, periodEnd);
      if (clampedEnd > clampedStart) cur.activeMinutes += (clampedEnd - clampedStart) / 60000;
    }
    const out = r.useful ?? r.end;
    if (out != null) {
      const iso = new Date(out).toISOString();
      if (cur.lastOutputAt == null || iso > cur.lastOutputAt) cur.lastOutputAt = iso;
    }
    byAgent.set(r.agentId, cur);
  }
  const agentBreakdown = [...byAgent.values()]
    .map((a) => ({ ...a, activeMinutes: Math.round(a.activeMinutes) }))
    .sort((a, b) => b.usefulRuns - a.usefulRuns || b.runs - a.runs);

  const incidents: AutonomyIncident[] = runMs
    .filter((r) => (FAILED_RUN_STATUSES.has(r.status) || !!r.error) && r.start != null && r.start >= periodStart)
    .map((r) => {
      const end = r.end ?? periodEnd;
      return {
        startedAt: new Date(r.start!).toISOString(),
        durationMinutes: Math.max(0, Math.round((end - r.start!) / 60000)),
        cause: r.error ? r.error.slice(0, 200) : r.status,
        agentId: r.agentId,
        agentName: nameById.get(r.agentId) ?? r.agentId,
      };
    })
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 50);

  return {
    period: input.period,
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
    bucketMinutes: BUCKET_MINUTES,
    kpis,
    heatmap: cells,
    agents: agentBreakdown,
    incidents,
  };
}

export function autonomyService(db: Db) {
  return {
    report: async (companyId: string, period: AutonomyPeriodKey): Promise<AutonomyReport> => {
      const now = Date.now();
      const since = new Date(now - PERIOD_HOURS[period] * 60 * 60 * 1000);
      const runRows = await db
        .select({
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          lastUsefulActionAt: heartbeatRuns.lastUsefulActionAt,
          error: heartbeatRuns.error,
          livenessState: heartbeatRuns.livenessState,
        })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), gte(heartbeatRuns.createdAt, since)));
      const issueRows = await db
        .select({
          status: issues.status,
          benjaminRequired: issues.benjaminRequired,
          createdAt: issues.createdAt,
          completedAt: issues.completedAt,
          hiddenAt: issues.hiddenAt,
        })
        .from(issues)
        .where(eq(issues.companyId, companyId));
      const agentRows = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(eq(agents.companyId, companyId));

      return computeAutonomyReport({
        period,
        now,
        runs: runRows,
        issues: issueRows,
        agents: agentRows,
        estimatedCostCents: null,
      });
    },
  };
}
