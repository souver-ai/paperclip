import { describe, expect, it } from "vitest";
import { computeAutonomyReport, type AutonomyRunInput, type AutonomyIssueInput } from "./autonomy.js";

const NOW = Date.parse("2026-05-27T12:00:00.000Z");
const H = 60 * 60 * 1000;
function ago(hours: number): Date { return new Date(NOW - hours * H); }

function base(over: Partial<Parameters<typeof computeAutonomyReport>[0]> = {}) {
  return computeAutonomyReport({
    period: "24h", now: NOW, runs: [], issues: [], agents: [{ id: "a1", name: "CTO" }], ...over,
  });
}

const usefulRun = (h: number): AutonomyRunInput => ({
  agentId: "a1", status: "succeeded", startedAt: ago(h + 0.5), finishedAt: ago(h),
  lastUsefulActionAt: ago(h + 0.2), error: null, livenessState: null,
});
const idleRun = (h: number): AutonomyRunInput => ({
  agentId: "a1", status: "succeeded", startedAt: ago(h + 0.5), finishedAt: ago(h),
  lastUsefulActionAt: null, error: null, livenessState: null,
});
const actionableIssue = (): AutonomyIssueInput => ({
  status: "in_progress", benjaminRequired: false, createdAt: ago(48), completedAt: null, hiddenAt: null,
});
const benjaminIssue = (): AutonomyIssueInput => ({
  status: "blocked", benjaminRequired: true, createdAt: ago(48), completedAt: null, hiddenAt: null,
});

describe("computeAutonomyReport", () => {
  it("empty period: coverage n/a, zero presence, all absent", () => {
    const r = base();
    expect(r.kpis.autonomousCoveragePct).toBeNull();
    expect(r.kpis.raw247PresencePct).toBe(0);
    expect(r.kpis.totalBuckets).toBe(24);
    expect(r.heatmap.every((c) => c.state === "absent")).toBe(true);
  });

  it("all Benjamin-gated work: not actionable, coverage n/a, human_gate present", () => {
    const r = base({ issues: [benjaminIssue()] });
    expect(r.kpis.actionableBuckets).toBe(0);
    expect(r.kpis.autonomousCoveragePct).toBeNull();
    expect(r.heatmap.some((c) => c.state === "human_gate")).toBe(true);
    expect(r.heatmap.some((c) => c.state === "incident")).toBe(false);
  });

  it("actionable queue with no run: incident buckets, coverage 0%", () => {
    const r = base({ issues: [actionableIssue()] });
    expect(r.kpis.actionableBuckets).toBe(24);
    expect(r.kpis.coveredBuckets).toBe(0);
    expect(r.kpis.incidentBuckets).toBe(24);
    expect(r.kpis.autonomousCoveragePct).toBe(0);
    expect(r.kpis.raw247PresencePct).toBe(0);
  });

  it("run without useful output does not count as covered (stays incident)", () => {
    const r = base({ issues: [actionableIssue()], runs: [idleRun(3)] });
    expect(r.kpis.usefulRuns).toBe(0);
    expect(r.kpis.coveredBuckets).toBe(0);
    expect(r.kpis.presentBuckets).toBeGreaterThan(0); // present but not useful
    expect(r.kpis.incidentBuckets).toBe(24);
  });

  it("useful run on actionable queue: that bucket is covered", () => {
    const r = base({ issues: [actionableIssue()], runs: [usefulRun(3)] });
    expect(r.kpis.usefulRuns).toBe(1);
    expect(r.kpis.coveredBuckets).toBe(1);
    expect(r.kpis.incidentBuckets).toBe(23);
    expect(r.kpis.autonomousCoveragePct).toBeCloseTo((1 / 24) * 100, 5);
    const agent = r.agents.find((a) => a.agentId === "a1")!;
    expect(agent.usefulRuns).toBe(1);
    expect(agent.name).toBe("CTO");
  });

  it("failed run surfaces as an incident entry", () => {
    const r = base({
      runs: [{ agentId: "a1", status: "failed", startedAt: ago(2), finishedAt: ago(1.5),
        lastUsefulActionAt: null, error: "boom", livenessState: null }],
    });
    expect(r.incidents).toHaveLength(1);
    expect(r.incidents[0]!.cause).toBe("boom");
    expect(r.agents[0]!.failedRuns).toBe(1);
  });
});
