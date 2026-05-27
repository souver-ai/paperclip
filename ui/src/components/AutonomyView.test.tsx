// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutonomyReport } from "@paperclipai/shared";
import { AutonomyView } from "./AutonomyView";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function report(over: Partial<AutonomyReport> = {}): AutonomyReport {
  return {
    period: "24h",
    periodStart: "2026-05-26T12:00:00.000Z",
    periodEnd: "2026-05-27T12:00:00.000Z",
    bucketMinutes: 60,
    kpis: {
      autonomousCoveragePct: 75, raw247PresencePct: 50, actionableBuckets: 8, coveredBuckets: 6,
      incidentBuckets: 2, presentBuckets: 12, totalBuckets: 24, usefulRuns: 6, estimatedCostCents: null,
    },
    heatmap: [{ dayOfWeek: 2, hour: 9, state: "incident" }],
    agents: [{ agentId: "a1", name: "CTO", runs: 5, usefulRuns: 4, failedRuns: 1, activeMinutes: 120, lastOutputAt: "2026-05-27T11:30:00.000Z" }],
    incidents: [{ startedAt: "2026-05-27T09:00:00.000Z", durationMinutes: 30, cause: "boom", agentId: "a1", agentName: "CTO" }],
    ...over,
  };
}

describe("AutonomyView", () => {
  let container: HTMLDivElement;
  function render(r: AutonomyReport) {
    const root = createRoot(container);
    act(() => root.render(<AutonomyView report={r} />));
    return root;
  }
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { container.remove(); document.body.innerHTML = ""; });

  it("renders coverage KPI and per-agent + incident rows", () => {
    const root = render(report());
    expect(container.querySelector('[data-testid="kpi-coverage"]')?.textContent).toContain("75%");
    expect(container.textContent).toContain("CTO");
    expect(container.textContent).toContain("boom");
    const cell = container.querySelector('[data-testid="cell-2-9"]')!;
    expect(cell.getAttribute("data-state")).toBe("incident");
    act(() => root.unmount());
  });

  it("shows n/a coverage and cost fallback when not available", () => {
    const root = render(report({
      kpis: { autonomousCoveragePct: null, raw247PresencePct: 0, actionableBuckets: 0, coveredBuckets: 0,
        incidentBuckets: 0, presentBuckets: 0, totalBuckets: 24, usefulRuns: 0, estimatedCostCents: null },
      agents: [], incidents: [],
    }));
    expect(container.querySelector('[data-testid="kpi-coverage"]')?.textContent).toContain("n/a");
    expect(container.textContent).toContain("non disponible");
    expect(container.textContent).toContain("Aucun run sur la periode");
    expect(container.textContent).toContain("Aucun incident sur la periode");
    act(() => root.unmount());
  });

  it("defaults unspecified heatmap cells to absent", () => {
    const root = render(report({ heatmap: [] }));
    expect(container.querySelector('[data-testid="cell-0-0"]')?.getAttribute("data-state")).toBe("absent");
    act(() => root.unmount());
  });
});
