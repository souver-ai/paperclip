import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decideQuotaGovernorAction,
  loadLatestQuotaGovernorSnapshot,
  parseQuotaGovernorReport,
  projectUsagePercent,
  selectCodexWeeklyWindow,
} from "./quota-governor.js";

function buildReport(opts: {
  status: string;
  summary: string;
  spend: string;
  quota: string;
  elapsed: string;
  remaining: string;
  burn: string;
  projected: string;
  projectedPct: string;
  action: string;
}): string {
  return `---
title: "Paperclip Quota Governor"
date: "2026-05-26T17:40:11+02:00"
status: "${opts.status}"
summary: "${opts.summary}"
---

# Paperclip Quota Governor

## Projection

- Quota source: \`company.budgetMonthlyCents / company.spentMonthlyCents\`
- Current spend: \`${opts.spend} EUR\`
- Monthly quota: \`${opts.quota} EUR\`
- Elapsed period: \`${opts.elapsed}d\`; remaining: \`${opts.remaining}d\`
- Observed daily burn: \`${opts.burn} EUR\`
- Projected period-end burn: \`${opts.projected} EUR\` (${opts.projectedPct}%)
- Target: \`90%\` of quota = \`900.00 EUR\`
- Safety band: \`+/-5%\`

## Cadence Drivers

| Kind | Name | Current cadence | Modeled runs/day | Observed spend |
|---|---|---:|---:|---:|
| routine | Routine - PR Digest | cron \`30 6 * * 1-5\` | 0.71 | 25.00 EUR |
| heartbeat | CTO | every 3600s | 24.00 | 100.00 EUR |

## Recommendation

- Action: \`${opts.action}\`
- Summary: ${opts.summary}
- Rationale: forecast vs target band.
- Approval required before mutation: \`true\`
`;
}

const overReport = buildReport({
  status: "slow_down", summary: "slow down: projected burn exceeds target",
  spend: "900.00", quota: "1000.00", elapsed: "20.00", remaining: "10.00",
  burn: "45.00", projected: "1350.00", projectedPct: "135.0", action: "slow_down",
});

describe("parseQuotaGovernorReport", () => {
  it("derives over_target band, high confidence, hurting cadence", () => {
    const parsed = parseQuotaGovernorReport(overReport, "/tmp/report.md");
    expect(parsed.status).toBe("slow_down");
    expect(parsed.spentCents).toBe(90_000);
    expect(parsed.quotaCents).toBe(100_000);
    expect(parsed.remainingCents).toBe(10_000);
    expect(parsed.dailyBurnCents).toBe(4_500);
    expect(parsed.projectedEndCents).toBe(135_000);
    expect(parsed.projectedUtilization).toBe(1.35);
    expect(parsed.targetUtilization).toBe(0.9);
    expect(parsed.safetyBand).toBe(0.05);
    expect(parsed.band).toBe("over_target");
    expect(parsed.confidence).toBe("high");
    expect(parsed.cadenceEffect).toBe("hurting");
    expect(parsed.approvalRequired).toBe(true);
  });

  it("derives under_target band when projection lands below target minus safety band", () => {
    const parsed = parseQuotaGovernorReport(
      buildReport({
        status: "speed_up", summary: "under-consuming",
        spend: "300.00", quota: "1000.00", elapsed: "20.00", remaining: "10.00",
        burn: "15.00", projected: "450.00", projectedPct: "45.0", action: "speed_up",
      }),
      "/tmp/under.md",
    );
    expect(parsed.band).toBe("under_target");
    expect(parsed.confidence).toBe("high");
  });

  it("derives on_target band when projection stays inside the safety band", () => {
    const parsed = parseQuotaGovernorReport(
      buildReport({
        status: "hold", summary: "healthy",
        spend: "600.00", quota: "1000.00", elapsed: "20.00", remaining: "10.00",
        burn: "30.00", projected: "900.00", projectedPct: "90.0", action: "hold",
      }),
      "/tmp/on.md",
    );
    expect(parsed.band).toBe("on_target");
    expect(parsed.cadenceEffect).toBe("neutral");
  });

  it("falls back to low confidence when the forecast lacks enough elapsed data", () => {
    const parsed = parseQuotaGovernorReport(
      buildReport({
        status: "hold", summary: "too early",
        spend: "50.00", quota: "1000.00", elapsed: "1.00", remaining: "29.00",
        burn: "50.00", projected: "1500.00", projectedPct: "150.0", action: "hold",
      }),
      "/tmp/early.md",
    );
    expect(parsed.confidence).toBe("low");
  });

  it("parses cadence drivers from the report table", () => {
    const parsed = parseQuotaGovernorReport(overReport, "/tmp/report.md");
    expect(parsed.drivers).toEqual([
      { kind: "routine", name: "Routine - PR Digest", cadence: "cron 30 6 * * 1-5", runsPerDay: 0.71, observedSpendCents: 2_500 },
      { kind: "heartbeat", name: "CTO", cadence: "every 3600s", runsPerDay: 24, observedSpendCents: 10_000 },
    ]);
  });
});

describe("loadLatestQuotaGovernorSnapshot", () => {
  let tmpDir: string | null = null;
  afterEach(async () => {
    if (tmpDir) { await fs.rm(tmpDir, { recursive: true, force: true }); tmpDir = null; }
  });

  it("returns a null snapshot (no error) when the report dir has no reports", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qg-"));
    const result = await loadLatestQuotaGovernorSnapshot(tmpDir);
    expect(result.snapshot).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("returns an error envelope when the report dir is missing", async () => {
    const result = await loadLatestQuotaGovernorSnapshot("/nonexistent/qg-dir-xyz");
    expect(result.snapshot).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("parses the lexicographically latest -quota-governor.md report", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qg-"));
    await fs.writeFile(path.join(tmpDir, "2026-05-01-quota-governor.md"), overReport);
    await fs.writeFile(path.join(tmpDir, "2026-05-26-quota-governor.md"), overReport);
    await fs.writeFile(path.join(tmpDir, "ignore.md"), "noise");
    const result = await loadLatestQuotaGovernorSnapshot(tmpDir);
    expect(result.snapshot?.reportPath.endsWith("2026-05-26-quota-governor.md")).toBe(true);
    expect(result.snapshot?.band).toBe("over_target");
  });
});

describe("native quota governor forecast helpers", () => {
  it("selects the Codex weekly quota window from live provider results", () => {
    const window = selectCodexWeeklyWindow({
      provider: "openai",
      ok: true,
      source: "codex-app-server",
      windows: [
        { label: "5hlimit", usedPercent: 20, resetsAt: "2026-05-28T12:00:00.000Z", valueLabel: null },
        { label: "weeklylimit", usedPercent: 72, resetsAt: "2026-06-01T00:00:00.000Z", valueLabel: null },
      ],
    });

    expect(window?.label).toBe("weeklylimit");
    expect(window?.usedPercent).toBe(72);
  });

  it("projects end-of-window usage from provider percentage and elapsed time", () => {
    expect(projectUsagePercent({
      providerUsedPercent: 45,
      elapsedDays: 3,
      remainingDays: 4,
    })).toBe(105);
  });

  it("holds low-confidence forecasts and slows down high-confidence overages", () => {
    expect(decideQuotaGovernorAction(120, "low")).toBe("hold");
    expect(decideQuotaGovernorAction(120, "high")).toBe("slow_down");
    expect(decideQuotaGovernorAction(60, "high")).toBe("speed_up");
  });
});
