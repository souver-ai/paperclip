// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuotaGovernorSnapshot } from "@paperclipai/shared";
import { QuotaGovernorPanel } from "./QuotaGovernorPanel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(overrides: Partial<QuotaGovernorSnapshot> = {}): QuotaGovernorSnapshot {
  return {
    reportPath: "/tmp/2026-05-26-quota-governor.md",
    generatedAt: "2026-05-26T17:40:11+02:00",
    status: "hold",
    summary: "healthy",
    quotaSource: "company.budgetMonthlyCents",
    spentCents: 60_000,
    quotaCents: 100_000,
    remainingCents: 40_000,
    elapsedDays: 20,
    remainingDays: 10,
    dailyBurnCents: 3_000,
    projectedEndCents: 90_000,
    projectedUtilization: 0.9,
    targetUtilization: 0.9,
    targetCents: 90_000,
    safetyBand: 0.05,
    band: "on_target",
    confidence: "high",
    cadenceEffect: "neutral",
    recommendationAction: "hold",
    recommendationSummary: "stay the course",
    recommendationRationale: "inside band",
    approvalRequired: false,
    drivers: [
      { kind: "heartbeat", name: "CTO", cadence: "every 3600s", runsPerDay: 24, observedSpendCents: 10_000 },
    ],
    ...overrides,
  };
}

describe("QuotaGovernorPanel", () => {
  let container: HTMLDivElement;

  function render(s: QuotaGovernorSnapshot) {
    const root = createRoot(container);
    act(() => {
      root.render(<QuotaGovernorPanel snapshot={s} />);
    });
    return root;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders the on_target band and recommended action", () => {
    const root = render(snapshot());
    expect(container.querySelector('[data-testid="quota-governor-band"]')?.textContent).toBe("Sur cible");
    expect(container.querySelector('[data-testid="quota-governor-action"]')?.textContent).toBe("hold");
    expect(container.textContent).toContain("CTO");
    act(() => root.unmount());
  });

  it("renders the under_target band", () => {
    const root = render(snapshot({ band: "under_target", recommendationAction: "speed_up" }));
    expect(container.querySelector('[data-testid="quota-governor-band"]')?.textContent).toBe("Sous cible");
    act(() => root.unmount());
  });

  it("renders the over_target band with the slow_down action", () => {
    const root = render(snapshot({ band: "over_target", recommendationAction: "slow_down", cadenceEffect: "hurting" }));
    expect(container.querySelector('[data-testid="quota-governor-band"]')?.textContent).toBe("Au-dessus cible");
    expect(container.querySelector('[data-testid="quota-governor-action"]')?.textContent).toBe("slow_down");
    act(() => root.unmount());
  });

  it("renders the unknown band when the report lacks data", () => {
    const root = render(snapshot({ band: "unknown", drivers: [] }));
    expect(container.querySelector('[data-testid="quota-governor-band"]')?.textContent).toBe("Indetermine");
    expect(container.textContent).toContain("Aucun driver cadence");
    act(() => root.unmount());
  });
});
