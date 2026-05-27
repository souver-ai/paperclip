import { promises as fs } from "fs";
import path from "path";
import type {
  ForecastConfidence,
  QuotaGovernorBand,
  QuotaGovernorCadenceEffect,
  QuotaGovernorDriver,
  QuotaGovernorLoadResult,
  QuotaGovernorSnapshot,
} from "@paperclipai/shared";

const DEFAULT_REPORT_DIR =
  "/Users/openclaw/Developer/souver/ops/paperclip/reports/quota-governor";

export function getQuotaGovernorReportDir(): string {
  return process.env["PAPERCLIP_QUOTA_GOVERNOR_REPORT_DIR"] ?? DEFAULT_REPORT_DIR;
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
