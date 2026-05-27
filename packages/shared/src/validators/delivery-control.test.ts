import { describe, expect, it } from "vitest";
import {
  createHarnessFindingSchema,
  createHarnessRunSchema,
  createVerificationRunSchema,
  updateRepoLockSchema,
  upsertRepoLockSchema,
  upsertTestCaseSchema,
} from "./delivery-control.js";

describe("delivery control validators", () => {
  it("accepts repo lock routing and rejects unknown blocker types", () => {
    const parsed = upsertRepoLockSchema.parse({
      repo: "dashboard",
      state: "locked_cto",
      activeIssueId: "11111111-1111-4111-8111-111111111111",
      branch: "paperclip/SOU-123-clean-repo",
      nextAction: "Rebase branch on main before waking Dev Feature.",
      blockerType: "tail_waiting",
    });

    expect(parsed.state).toBe("locked_cto");
    expect(parsed.blockerType).toBe("tail_waiting");
    expect(updateRepoLockSchema.safeParse({ blockerType: "vibes" }).success).toBe(false);
  });

  it("accepts structured verification evidence", () => {
    const parsed = createVerificationRunSchema.parse({
      issueId: "11111111-1111-4111-8111-111111111111",
      repo: "paperclip",
      type: "unit",
      status: "in_progress",
      command: "pnpm vitest run packages/shared/src/validators/delivery-control.test.ts",
      artifactPaths: ["reports/verification/delivery-control.md"],
      verdictSummary: "Delivery control validators pass.",
    });

    expect(parsed.status).toBe("in_progress");
    expect(parsed.artifactPaths).toEqual(["reports/verification/delivery-control.md"]);
  });

  it("accepts read-only test case metadata while keeping proof status explicit", () => {
    const parsed = upsertTestCaseSchema.parse({
      stableKey: "desktop-cwd-access-refresh",
      title: "desktop-cwd-access-refresh",
      repo: "desktop",
      type: "e2e",
      trigger: "per_delivery",
      command: "pnpm --filter @souver/desktop test:e2e",
      owner: "Test Architect",
      requiredForDelivery: true,
      visibleRunnable: false,
      status: "active",
      source: "regression_ledger",
      lastStatus: "missing",
      nextAction: "Run required before this test can be terminal evidence.",
    });

    expect(parsed.owner).toBe("Test Architect");
    expect(parsed.lastStatus).toBe("missing");
  });

  it("accepts harness run findings with anti-recurrence routing", () => {
    const run = createHarnessRunSchema.parse({
      experimentId: "EXP-1",
      benchmarkName: "terminal-bench-visible",
      model: "openrouter/test-model",
      status: "inconclusive",
      verdictSummary: "Runtime failed before scoring.",
    });
    const finding = createHarnessFindingSchema.parse({
      title: "Harness runtime missing provider binding",
      severity: "high",
      status: "triaged",
      failureCategory: "missing_credentials",
      evidence: { provider: "openrouter", secretPrinted: false },
      antiRecurrencePatternId: "harness-provider-preflight",
    });

    expect(run.status).toBe("inconclusive");
    expect(finding.failureCategory).toBe("missing_credentials");
  });
});
