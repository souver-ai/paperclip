import { describe, expect, it } from "vitest";
import {
  createHarnessFindingSchema,
  createHarnessRunSchema,
  createVerificationRunSchema,
  updateRepoLockSchema,
  upsertRepoLockSchema,
} from "./delivery-control.js";

describe("delivery control validators", () => {
  it("accepts repo lock routing and rejects unknown blocker types", () => {
    const parsed = upsertRepoLockSchema.parse({
      repo: "dashboard",
      state: "locked_cto",
      activeIssueId: "11111111-1111-4111-8111-111111111111",
      branch: "paperclip/SOU-123-clean-repo",
      nextAction: "Rebase branch on main before waking Dev Feature.",
      blockerType: "branch_stale",
    });

    expect(parsed.state).toBe("locked_cto");
    expect(updateRepoLockSchema.safeParse({ blockerType: "vibes" }).success).toBe(false);
  });

  it("accepts structured verification evidence", () => {
    const parsed = createVerificationRunSchema.parse({
      issueId: "11111111-1111-4111-8111-111111111111",
      repo: "paperclip",
      type: "unit",
      status: "pass",
      command: "pnpm vitest run packages/shared/src/validators/delivery-control.test.ts",
      artifactPaths: ["reports/verification/delivery-control.md"],
      verdictSummary: "Delivery control validators pass.",
    });

    expect(parsed.status).toBe("pass");
    expect(parsed.artifactPaths).toEqual(["reports/verification/delivery-control.md"]);
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
