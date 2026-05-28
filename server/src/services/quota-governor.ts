import { promises as fs } from "fs";
import path from "path";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  costEvents,
  quotaGovernorSnapshots,
  routineTriggers,
  routines,
} from "@paperclipai/db";
import type {
  ProviderQuotaResult,
  ForecastConfidence,
  QuotaGovernorBand,
  QuotaGovernorCadenceChange,
  QuotaGovernorCadenceSnapshot,
  QuotaGovernorCadenceEffect,
  QuotaGovernorDriver,
  QuotaGovernorForecast,
  QuotaGovernorLoadResult,
  QuotaGovernorSnapshot,
  QuotaWindow,
} from "@paperclipai/shared";
import { parseCron } from "./cron.js";
import { fetchAllQuotaWindows } from "./quota-windows.js";

const DEFAULT_REPORT_DIR =
  "/Users/openclaw/Developer/souver/ops/paperclip/reports/quota-governor";
const TARGET_UTILIZATION = 0.9;
const SAFETY_BAND = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function getQuotaGovernorReportDir(): string {
  return process.env["PAPERCLIP_QUOTA_GOVERNOR_REPORT_DIR"] ?? DEFAULT_REPORT_DIR;
}

export function quotaGovernorService(
  db: Db,
  opts: { fetchQuotaWindows?: () => Promise<ProviderQuotaResult[]> } = {},
) {
  const fetchQuotaWindows = opts.fetchQuotaWindows ?? fetchAllQuotaWindows;

  return {
    latest: async (companyId: string): Promise<QuotaGovernorLoadResult> => {
      const [latest, history] = await Promise.all([
        db
          .select()
          .from(quotaGovernorSnapshots)
          .where(eq(quotaGovernorSnapshots.companyId, companyId))
          .orderBy(desc(quotaGovernorSnapshots.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db
          .select()
          .from(quotaGovernorSnapshots)
          .where(eq(quotaGovernorSnapshots.companyId, companyId))
          .orderBy(desc(quotaGovernorSnapshots.createdAt))
          .limit(10),
      ]);

      return {
        snapshot: latest ? rowToSnapshot(latest) : null,
        history: history.map(rowToSnapshot),
        reportDir: "native:quota_governor_snapshots",
      };
    },

    createSnapshot: async (
      companyId: string,
      options: { now?: Date; actor?: string; source?: string } = {},
    ): Promise<QuotaGovernorLoadResult> => {
      const now = options.now ?? new Date();
      const actor = options.actor ?? "quota_governor";
      const source = options.source ?? "manual";
      const quotaResults = await fetchQuotaWindows();
      const codexResult = quotaResults.find((result) => result.provider === "openai");
      const weeklyWindow = selectCodexWeeklyWindow(codexResult);
      const cadenceSnapshot = await buildCadenceSnapshot(db, companyId);
      const quotaSource = codexResult?.source ?? "codex-quota-windows";
      const resetAt = weeklyWindow?.resetsAt ? new Date(weeklyWindow.resetsAt) : null;
      const windowStartAt = resetAt ? new Date(resetAt.getTime() - WEEK_MS) : new Date(now.getTime() - WEEK_MS);
      const snapshotDate = now.toISOString().slice(0, 10);
      const quotaWindowKey = [
        "codex-weekly",
        resetAt ? resetAt.toISOString() : snapshotDate,
      ].join(":");
      const usageCents = await sumCodexUsageCents(db, companyId, windowStartAt, resetAt ?? now);
      const providerUsedPercent =
        typeof weeklyWindow?.usedPercent === "number" && Number.isFinite(weeklyWindow.usedPercent)
          ? Math.max(0, weeklyWindow.usedPercent)
          : null;
      const quotaLimitCents =
        providerUsedPercent && providerUsedPercent > 0
          ? Math.round(usageCents / (providerUsedPercent / 100))
          : null;
      const elapsedDays = Math.max((now.getTime() - windowStartAt.getTime()) / DAY_MS, 0);
      const remainingDays = Math.max(((resetAt ?? new Date(now.getTime() + WEEK_MS)).getTime() - now.getTime()) / DAY_MS, 0);
      const projectedUsagePercent = projectUsagePercent({
        providerUsedPercent,
        elapsedDays,
        remainingDays,
      });
      const confidence = deriveConfidence(elapsedDays, usageCents);
      const decision = decideQuotaGovernorAction(projectedUsagePercent, confidence);
      const forecast: QuotaGovernorForecast = {
        elapsedDays,
        remainingDays,
        providerUsedPercent,
        projectedUsagePercent,
        thresholdPercent: TARGET_UTILIZATION * 100,
        confidence,
        resetAt: resetAt?.toISOString() ?? null,
        windowStartAt: windowStartAt.toISOString(),
        quotaLimitCents,
        usageCents,
      };
      const cadenceChanges = proposeCadenceChanges({
        decision,
        cadenceSnapshot,
        actor,
        source,
        now,
      });
      const error = codexResult?.ok === false
        ? codexResult.error ?? "Codex quota provider returned an error"
        : weeklyWindow
          ? null
          : "Codex weekly quota window unavailable";

      const [row] = await db
        .insert(quotaGovernorSnapshots)
        .values({
          companyId,
          snapshotDate,
          quotaWindowKey,
          quotaSource,
          quotaWindow: {
            provider: codexResult?.provider ?? "openai",
            ok: codexResult?.ok ?? false,
            source: codexResult?.source ?? null,
            window: weeklyWindow ?? null,
          },
          windowStartAt,
          resetAt,
          usageCents,
          quotaLimitCents,
          providerUsedPercent,
          projectedUsagePercent,
          decision,
          forecast,
          cadenceSnapshot,
          cadenceChanges,
          error,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            quotaGovernorSnapshots.companyId,
            quotaGovernorSnapshots.snapshotDate,
            quotaGovernorSnapshots.quotaWindowKey,
          ],
          set: {
            quotaSource,
            quotaWindow: {
              provider: codexResult?.provider ?? "openai",
              ok: codexResult?.ok ?? false,
              source: codexResult?.source ?? null,
              window: weeklyWindow ?? null,
            },
            windowStartAt,
            resetAt,
            usageCents,
            quotaLimitCents,
            providerUsedPercent,
            projectedUsagePercent,
            decision,
            forecast,
            cadenceSnapshot,
            cadenceChanges,
            error,
            updatedAt: now,
          },
        })
        .returning();

      return {
        snapshot: row ? rowToSnapshot(row) : null,
        history: row ? [rowToSnapshot(row)] : [],
        reportDir: "native:quota_governor_snapshots",
      };
    },
  };
}

export function selectCodexWeeklyWindow(result?: ProviderQuotaResult): QuotaWindow | null {
  if (!result?.ok) return null;
  return result.windows.find((window) => {
    const label = window.label.toLowerCase().replace(/[\s_-]/g, "");
    return label.includes("weeklylimit") || label.includes("7d") || label.includes("week");
  }) ?? null;
}

async function sumCodexUsageCents(
  db: Db,
  companyId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision` })
    .from(costEvents)
    .where(and(
      eq(costEvents.companyId, companyId),
      eq(costEvents.provider, "openai"),
      gte(costEvents.occurredAt, from),
      lt(costEvents.occurredAt, to),
    ));
  return Math.round(Number(row?.total ?? 0));
}

async function buildCadenceSnapshot(db: Db, companyId: string): Promise<QuotaGovernorCadenceSnapshot> {
  const [agentRows, routineRows] = await Promise.all([
    db.select().from(agents).where(eq(agents.companyId, companyId)),
    db
      .select({
        trigger: routineTriggers,
        routine: routines,
      })
      .from(routineTriggers)
      .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
      .where(eq(routineTriggers.companyId, companyId)),
  ]);

  return {
    heartbeats: agentRows.map((agent) => {
      const heartbeat = readHeartbeatConfig(agent.runtimeConfig);
      return {
        kind: "heartbeat",
        id: agent.id,
        name: agent.name,
        cadence: heartbeat.enabled && heartbeat.intervalSec > 0
          ? `every ${heartbeat.intervalSec}s`
          : "disabled",
        runsPerDay: heartbeat.enabled && heartbeat.intervalSec > 0 ? 86_400 / heartbeat.intervalSec : 0,
        observedSpendCents: 0,
        enabled: heartbeat.enabled,
        status: agent.status,
        criticality: isCriticalAgent(agent) ? "critical" : "non_critical",
      };
    }),
    routines: routineRows.map(({ trigger, routine }) => ({
      kind: "routine",
      id: trigger.id,
      name: trigger.label || routine.title,
      cadence: trigger.kind === "schedule" && trigger.cronExpression
        ? `cron ${trigger.cronExpression}`
        : trigger.kind,
      runsPerDay: trigger.enabled && trigger.kind === "schedule" && trigger.cronExpression
        ? estimateCronRunsPerDay(trigger.cronExpression)
        : 0,
      observedSpendCents: 0,
      enabled: trigger.enabled,
      status: routine.status,
      criticality: routine.priority === "critical" ? "critical" : "non_critical",
    })),
  };
}

function readHeartbeatConfig(runtimeConfig: Record<string, unknown> | null | undefined): {
  enabled: boolean;
  intervalSec: number;
} {
  const heartbeat = asRecord(asRecord(runtimeConfig)?.["heartbeat"]);
  const enabled = heartbeat?.["enabled"] === true;
  const rawInterval = Number(heartbeat?.["intervalSec"]);
  return {
    enabled,
    intervalSec: Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isCriticalAgent(agent: typeof agents.$inferSelect): boolean {
  const searchable = `${agent.role ?? ""} ${agent.title ?? ""} ${agent.capabilities ?? ""}`.toLowerCase();
  return searchable.includes("critical") || searchable.includes("gatekeeper") || searchable.includes("security");
}

function estimateCronRunsPerDay(expression: string): number {
  try {
    const cron = parseCron(expression);
    const daysPerWeek = Math.max(cron.daysOfWeek.length, 1);
    return Number(((cron.minutes.length * cron.hours.length * daysPerWeek) / 7).toFixed(2));
  } catch {
    return 0;
  }
}

export function projectUsagePercent(input: {
  providerUsedPercent: number | null;
  elapsedDays: number;
  remainingDays: number;
}): number {
  if (input.providerUsedPercent == null || input.elapsedDays <= 0) return 0;
  const dailyPercent = input.providerUsedPercent / input.elapsedDays;
  return Number(Math.max(input.providerUsedPercent, input.providerUsedPercent + dailyPercent * input.remainingDays).toFixed(2));
}

export function decideQuotaGovernorAction(projectedUsagePercent: number, confidence: ForecastConfidence): string {
  if (confidence === "low" || projectedUsagePercent <= 0) return "hold";
  const targetPercent = TARGET_UTILIZATION * 100;
  if (projectedUsagePercent > targetPercent) return "slow_down";
  if (projectedUsagePercent < (TARGET_UTILIZATION - SAFETY_BAND) * 100) return "speed_up";
  return "hold";
}

function proposeCadenceChanges(input: {
  decision: string;
  cadenceSnapshot: QuotaGovernorCadenceSnapshot;
  actor: string;
  source: string;
  now: Date;
}): QuotaGovernorCadenceChange[] {
  if (input.decision === "hold") return [];
  const createdAt = input.now.toISOString();
  const changes: QuotaGovernorCadenceChange[] = [];

  for (const driver of input.cadenceSnapshot.heartbeats) {
    if (driver.criticality === "critical" || !driver.enabled) continue;
    const interval = Number(driver.cadence.match(/every (\d+)s/)?.[1] ?? 0);
    if (!interval) continue;
    const next = input.decision === "slow_down"
      ? Math.min(Math.max(interval * 2, 1_800), 21_600)
      : Math.max(Math.floor(interval * 0.8), 900);
    if (next === interval) continue;
    changes.push({
      targetType: "heartbeat",
      targetId: driver.id ?? driver.name,
      targetName: driver.name,
      field: "runtimeConfig.heartbeat.intervalSec",
      previousValue: interval,
      nextValue: next,
      reason: `${input.decision}: projected Codex weekly usage vs 90% threshold`,
      actor: input.actor,
      source: input.source,
      createdAt,
      applied: false,
    });
  }

  for (const driver of input.cadenceSnapshot.routines) {
    if (driver.criticality === "critical" || !driver.enabled || !driver.cadence.startsWith("cron ")) continue;
    if (input.decision === "slow_down") {
      changes.push({
        targetType: "routine_trigger",
        targetId: driver.id ?? driver.name,
        targetName: driver.name,
        field: "enabled",
        previousValue: true,
        nextValue: false,
        reason: "slow_down: non-critical scheduled routine proposed for pause; event/webhook triggers are preserved",
        actor: input.actor,
        source: input.source,
        createdAt,
        applied: false,
      });
    }
  }

  return changes;
}

function rowToSnapshot(row: typeof quotaGovernorSnapshots.$inferSelect): QuotaGovernorSnapshot {
  const forecast = row.forecast;
  const projectedUtilization = (forecast.projectedUsagePercent ?? 0) / 100;
  const targetCents = row.quotaLimitCents ? Math.round(row.quotaLimitCents * TARGET_UTILIZATION) : 0;
  const quotaCents = row.quotaLimitCents ?? 0;
  return {
    id: row.id,
    reportPath: `native://quota-governor/${row.id}`,
    generatedAt: row.createdAt.toISOString(),
    status: row.decision,
    summary: row.error ?? `${row.decision} from persisted Codex weekly quota snapshot`,
    quotaSource: row.quotaSource,
    spentCents: row.usageCents,
    quotaCents,
    remainingCents: quotaCents > 0 ? Math.max(quotaCents - row.usageCents, 0) : 0,
    elapsedDays: forecast.elapsedDays,
    remainingDays: forecast.remainingDays,
    dailyBurnCents: forecast.elapsedDays > 0 ? Math.round(row.usageCents / forecast.elapsedDays) : 0,
    projectedEndCents: quotaCents > 0 ? Math.round(quotaCents * projectedUtilization) : row.usageCents,
    projectedUtilization,
    targetUtilization: TARGET_UTILIZATION,
    targetCents,
    safetyBand: SAFETY_BAND,
    band: deriveBand(projectedUtilization, TARGET_UTILIZATION, SAFETY_BAND),
    confidence: forecast.confidence,
    cadenceEffect: deriveCadenceEffect(row.decision),
    recommendationAction: row.decision,
    recommendationSummary: row.cadenceChanges.length > 0
      ? `${row.cadenceChanges.length} cadence change(s) proposed`
      : "No cadence mutation proposed",
    recommendationRationale: "Projected Codex weekly quota usage compared with the 90% threshold.",
    approvalRequired: row.cadenceChanges.length > 0,
    drivers: [...row.cadenceSnapshot.heartbeats, ...row.cadenceSnapshot.routines],
    resetAt: row.resetAt?.toISOString() ?? null,
    windowStartAt: row.windowStartAt?.toISOString() ?? null,
    quotaUsedPercent: row.providerUsedPercent,
    forecast,
    cadenceSnapshot: row.cadenceSnapshot,
    cadenceChanges: row.cadenceChanges,
    error: row.error,
  };
}

export async function loadLatestQuotaGovernorSnapshot(
  reportDir = getQuotaGovernorReportDir(),
): Promise<QuotaGovernorLoadResult> {
  try {
    const files = await fs.readdir(reportDir, { withFileTypes: true });
    const reports = files
      .filter((file) => file.isFile() && file.name.endsWith("-quota-governor.md"))
      .map((file) => path.join(reportDir, file.name))
      .sort();

    const latest = reports.at(-1);
    if (!latest) {
      return { snapshot: null, reportDir };
    }

    const markdown = await fs.readFile(latest, "utf8");
    return { snapshot: parseQuotaGovernorReport(markdown, latest), reportDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { snapshot: null, reportDir, error: message };
  }
}

export function parseQuotaGovernorReport(
  markdown: string,
  reportPath: string,
): QuotaGovernorSnapshot {
  const frontmatter = parseFrontmatter(markdown);
  const projectionBullets = parseBullets(section(markdown, "Projection"));
  const recommendationBullets = parseBullets(section(markdown, "Recommendation"));

  const spentCents = parseEuroCents(projectionBullets["Current spend"]);
  const quotaCents = parseEuroCents(projectionBullets["Monthly quota"]);
  const dailyBurnCents = parseEuroCents(projectionBullets["Observed daily burn"]);
  const projectedEnd = parseProjectedEnd(projectionBullets["Projected period-end burn"]);
  const target = parseTarget(projectionBullets["Target"]);
  const safetyBand = parsePercent(projectionBullets["Safety band"]);
  const elapsed = parseElapsed(projectionBullets["Elapsed period"]);
  const recommendationAction =
    stripCode(recommendationBullets["Action"]) || frontmatter["status"] || "unknown";

  return {
    reportPath,
    generatedAt: frontmatter["date"] ?? null,
    status: frontmatter["status"] ?? recommendationAction,
    summary: frontmatter["summary"] ?? recommendationBullets["Summary"] ?? "",
    quotaSource: stripCode(projectionBullets["Quota source"]),
    spentCents,
    quotaCents,
    remainingCents: Math.max(quotaCents - spentCents, 0),
    elapsedDays: elapsed.elapsedDays,
    remainingDays: elapsed.remainingDays,
    dailyBurnCents,
    projectedEndCents: projectedEnd.cents,
    projectedUtilization: projectedEnd.utilization,
    targetUtilization: target.utilization,
    targetCents: target.cents,
    safetyBand,
    band: deriveBand(projectedEnd.utilization, target.utilization, safetyBand),
    confidence: deriveConfidence(elapsed.elapsedDays, spentCents),
    cadenceEffect: deriveCadenceEffect(recommendationAction),
    recommendationAction,
    recommendationSummary: recommendationBullets["Summary"] ?? "",
    recommendationRationale: recommendationBullets["Rationale"] ?? "",
    approvalRequired:
      stripCode(recommendationBullets["Approval required before mutation"]) === "true",
    drivers: parseDriverTable(section(markdown, "Cadence Drivers")),
  };
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const raw of match[1]!.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("-") || !line.includes(":")) continue;
    const [key, ...rest] = line.split(":");
    out[key!.trim()] = rest.join(":").trim().replace(/^"|"$/g, "");
  }
  return out;
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const next = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

function parseBullets(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ") || !line.includes(":")) continue;
    const [key, ...rest] = line.slice(2).split(":");
    out[key!.trim()] = rest.join(":").trim();
  }
  return out;
}

function parseDriverTable(input: string): QuotaGovernorDriver[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 5 && cells[0] !== "none")
    .map(([kind, name, cadence, runsPerDay, spend]) => ({
      kind: kind ?? "",
      name: name ?? "",
      cadence: stripCode(cadence ?? ""),
      runsPerDay: Number.parseFloat(runsPerDay ?? "0") || 0,
      observedSpendCents: parseEuroCents(spend),
    }));
}

function parseEuroCents(input?: string): number {
  const cleaned = stripCode(input ?? "").replace(",", ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Math.round(Number.parseFloat(match[0]!) * 100);
}

function parsePercent(input?: string): number {
  const cleaned = stripCode(input ?? "").replace(",", ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  return Math.abs(Number.parseFloat(match[0]!)) / 100;
}

function parseProjectedEnd(input?: string): { cents: number; utilization: number } {
  const cents = parseEuroCents(input);
  const utilizationMatch = (input ?? "").match(/\((\d+(?:\.\d+)?)%\)/);
  return {
    cents,
    utilization: utilizationMatch ? Number.parseFloat(utilizationMatch[1]!) / 100 : 0,
  };
}

function parseTarget(input?: string): { utilization: number; cents: number } {
  const cleaned = stripCode(input ?? "");
  const utilizationMatch = cleaned.match(/(\d+(?:\.\d+)?)%/);
  const cents = parseEuroCents(cleaned.split("=").at(1) ?? cleaned);
  return {
    utilization: utilizationMatch ? Number.parseFloat(utilizationMatch[1]!) / 100 : 0,
    cents,
  };
}

function parseElapsed(input?: string): { elapsedDays: number; remainingDays: number } {
  const cleaned = stripCode(input ?? "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)d.*?remaining:\s*(\d+(?:\.\d+)?)d/);
  return {
    elapsedDays: match ? Number.parseFloat(match[1]!) : 0,
    remainingDays: match ? Number.parseFloat(match[2]!) : 0,
  };
}

function stripCode(input?: string): string {
  return (input ?? "").replace(/`/g, "").trim();
}

function deriveBand(
  projectedUtilization: number,
  targetUtilization: number,
  safetyBand: number,
): QuotaGovernorBand {
  if (!projectedUtilization || !targetUtilization) return "unknown";
  if (projectedUtilization < targetUtilization - safetyBand) return "under_target";
  if (projectedUtilization > targetUtilization + safetyBand) return "over_target";
  return "on_target";
}

function deriveConfidence(elapsedDays: number, spentCents: number): ForecastConfidence {
  if (spentCents <= 0 || elapsedDays < 3) return "low";
  if (elapsedDays < 7) return "medium";
  return "high";
}

function deriveCadenceEffect(action: string): QuotaGovernorCadenceEffect {
  if (action === "speed_up" || action === "slow_down") return "hurting";
  if (action === "hold") return "neutral";
  if (action === "on_target") return "helping";
  return "unknown";
}
