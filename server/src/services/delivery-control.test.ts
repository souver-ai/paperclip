import { describe, expect, it } from "vitest";
import { buildAutoMergeCandidates } from "./delivery-control.js";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    title: "CLI low-risk fix",
    description: "Small app_cli fix",
    status: "in_review",
    surfaces: ["app_cli"],
    deliveryState: "merge_ready",
    blockerType: null,
    benjaminRequired: false,
    autoMergeEligible: false,
    repoLockId: "22222222-2222-4222-8222-222222222222",
    identifier: "SOU-1",
    updatedAt: new Date("2026-05-26T01:00:00.000Z"),
    ...overrides,
  } as any;
}

function lock(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    companyId: "company-1",
    repo: "app_cli",
    state: "in_review",
    activeIssueId: "11111111-1111-4111-8111-111111111111",
    branch: "paperclip/SOU-1-low-risk",
    prUrl: "https://github.com/souver-ai/souver-cli/pull/123",
    ownerAgentId: null,
    blockerType: null,
    nextAction: null,
    expiresAt: null,
    createdAt: new Date("2026-05-26T00:00:00.000Z"),
    updatedAt: new Date("2026-05-26T01:00:00.000Z"),
    ...overrides,
  } as any;
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    companyId: "company-1",
    issueId: "11111111-1111-4111-8111-111111111111",
    featureId: null,
    repo: "app_cli",
    type: "unit",
    status: "pass",
    command: "pnpm test",
    startedAt: new Date("2026-05-26T01:01:00.000Z"),
    finishedAt: new Date("2026-05-26T01:02:00.000Z"),
    durationSec: 60,
    commitSha: "abcdef1",
    branch: "paperclip/SOU-1-low-risk",
    prUrl: "https://github.com/souver-ai/souver-cli/pull/123",
    artifactPaths: [],
    verdictSummary: "green",
    failureCategory: null,
    nextAction: null,
    ownerAgentId: null,
    createdAt: new Date("2026-05-26T01:02:00.000Z"),
    updatedAt: new Date("2026-05-26T01:02:00.000Z"),
    ...overrides,
  } as any;
}

describe("buildAutoMergeCandidates", () => {
  it("marks low-risk non-dashboard merge-ready issues eligible when evidence is green", () => {
    const [candidate] = buildAutoMergeCandidates(
      [issue()],
      [lock()],
      [verification(), verification({ id: "44444444-4444-4444-8444-444444444444", type: "security", status: "pass" })],
    );

    expect(candidate).toMatchObject({
      issueId: "11111111-1111-4111-8111-111111111111",
      repo: "app_cli",
      eligible: true,
      reasons: [],
      passedVerificationCount: 2,
      securityStatus: "pass",
    });
  });

  it("keeps dashboard and failing verification out of auto-merge", () => {
    const [candidate] = buildAutoMergeCandidates(
      [issue({
        title: "Dashboard auth migration",
        surfaces: ["dashboard"],
        autoMergeEligible: true,
      })],
      [lock({
        repo: "dashboard",
        blockerType: "branch_stale",
      })],
      [verification({ repo: "dashboard", status: "fail", failureCategory: "test_failure" })],
    );

    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reasons).toEqual(expect.arrayContaining([
      "dashboard_requires_benjamin",
      "sensitive_surface",
      "repo_blocker:branch_stale",
      "verification_not_green",
    ]));
  });
});
