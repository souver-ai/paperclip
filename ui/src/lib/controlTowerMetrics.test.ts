import { describe, expect, it } from "vitest";
import {
  computeAttentionQueue,
  computePulse,
  computeSourceHealth,
  dataHealth,
  type ControlTowerData,
} from "./controlTowerMetrics";

const NOW = new Date("2026-05-28T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function emptyData(): ControlTowerData {
  return {
    issues: [],
    testCases: [],
    features: [],
    harnessFindings: [],
    autoMergeCandidates: [],
    repoLocks: [],
    verificationRuns: [],
  };
}

describe("dataHealth", () => {
  it("reports empty (unknown) when no record ever exists", () => {
    const h = dataHealth([], NOW, 7 * DAY);
    expect(h.state).toBe("empty");
    expect(h.total).toBe(0);
    expect(h.lastActivityAt).toBeNull();
  });

  it("reports ok when a record is within the staleness threshold", () => {
    const h = dataHealth([new Date(NOW - 1 * DAY)], NOW, 7 * DAY);
    expect(h.state).toBe("ok");
    expect(h.total).toBe(1);
  });

  it("reports stale when the most recent record is past the threshold", () => {
    const h = dataHealth([new Date(NOW - 10 * DAY)], NOW, 7 * DAY);
    expect(h.state).toBe("stale");
  });
});

describe("computePulse", () => {
  it("counts new tests in the active window and the previous window", () => {
    const data = emptyData();
    data.testCases = [
      { createdAt: new Date(NOW - 1 * DAY) }, // in 7d window
      { createdAt: new Date(NOW - 6 * DAY) }, // in 7d window
      { createdAt: new Date(NOW - 9 * DAY) }, // previous 7d window
      { createdAt: new Date(NOW - 40 * DAY) }, // outside both
    ] as ControlTowerData["testCases"];

    const pulse = computePulse(data, "7d", NOW);
    const newTests = pulse.find((k) => k.key === "new-tests")!;
    expect(newTests.value).toBe(2);
    expect(newTests.previous).toBe(1);
    expect(newTests.confidence).toBe("measured");
    expect(newTests.trend).toHaveLength(7);
  });

  it("distinguishes a real zero (producer alive) from unknown (never produced)", () => {
    // Harness produced findings recently, but none inside the window → real 0.
    const alive = emptyData();
    alive.harnessFindings = [
      { createdAt: new Date(NOW - 10 * DAY) },
    ] as ControlTowerData["harnessFindings"];
    const aliveKpi = computePulse(alive, "7d", NOW).find((k) => k.key === "harness-hypotheses")!;
    expect(aliveKpi.value).toBe(0);
    expect(aliveKpi.health.state).toBe("ok"); // 10d < 14d stale threshold

    // No finding ever → unknown.
    const unknownKpi = computePulse(emptyData(), "7d", NOW).find((k) => k.key === "harness-hypotheses")!;
    expect(unknownKpi.value).toBe(0);
    expect(unknownKpi.health.state).toBe("empty");
  });

  it("marks PR merged as a proxy KPI", () => {
    const data = emptyData();
    data.issues = [
      { deliveryState: "merged_verified", updatedAt: new Date(NOW - 2 * DAY), status: "done" },
    ] as unknown as ControlTowerData["issues"];
    const merged = computePulse(data, "7d", NOW).find((k) => k.key === "prs-merged")!;
    expect(merged.value).toBe(1);
    expect(merged.confidence).toBe("proxy");
  });
});

describe("computeAttentionQueue", () => {
  it("surfaces silent and never-seen producers as actionable items", () => {
    const data = emptyData();
    const health = computeSourceHealth(data, NOW); // all empty
    const queue = computeAttentionQueue(data, health);
    expect(queue.some((i) => i.category === "Producteur" && i.title.includes("aucune donnée"))).toBe(true);
  });

  it("ranks danger above warning", () => {
    const data = emptyData();
    data.verificationRuns = [
      { id: "r1", status: "fail", verdictSummary: "boom", repo: "app", prUrl: null },
    ] as unknown as ControlTowerData["verificationRuns"];
    const queue = computeAttentionQueue(data, []);
    expect(queue[0].severity).toBe("danger");
  });
});
