import { describe, expect, it } from "vitest";
import { buildAutoMergeCandidates, buildFeatureBackfillCandidates } from "./delivery-control.js";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    title: "CLI low-risk fix",
    description: "Small app_cli fix",
    status: "in_review",
    surfaces: ["app_cli"],
    category: "uncategorized",
    deliveryState: "merge_ready",
    blockerType: null,
    benjaminRequired: false,
    autoMergeEligible: false,
    repoLockId: "22222222-2222-4222-8222-222222222222",
    identifier: "SOU-1",
    issueNumber: 1,
    priority: "medium",
    nextAction: null,
    assigneeAgentId: null,
    terminalEvidence: null,
    hiddenAt: null,
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

  it("releases implementation slot for merged low-risk tails without terminal evidence", () => {
    const [candidate] = buildAutoMergeCandidates(
      [issue({
        deliveryState: "merged",
        terminalEvidence: null,
        title: "CLI merged low-risk fix",
        surfaces: ["app_cli"],
      })],
      [lock({
        state: "verification_tail",
        blockerType: null,
      })],
      [verification({
        status: "in_progress",
        startedAt: new Date("2026-05-26T01:00:00.000Z"),
        finishedAt: null,
        createdAt: new Date("2026-05-26T01:00:00.000Z"),
      })],
    );

    expect(candidate).toMatchObject({
      eligible: false,
      implementationSlot: "released",
      verificationTail: "pending",
      blockerType: null,
    });
    expect(candidate?.reasons).toContain("verification_tail_pending");
  });

  it("holds implementation slot when merged target verification fails", () => {
    const [candidate] = buildAutoMergeCandidates(
      [issue({
        deliveryState: "merged",
        blockerType: "test_gate",
        terminalEvidence: null,
      })],
      [lock({
        state: "locked_cto",
        blockerType: "test_gate",
      })],
      [verification({
        status: "fail",
        failureCategory: "test_failure",
      })],
    );

    expect(candidate).toMatchObject({
      implementationSlot: "held",
      verificationTail: "test_gate",
      blockerType: "test_gate",
      eligible: false,
    });
    expect(candidate?.reasons).toEqual(expect.arrayContaining([
      "repo_lock_not_ready",
      "repo_blocker:test_gate",
      "issue_blocker:test_gate",
      "verification_not_green",
    ]));
  });

  it("classifies stale in-progress verification tails after thirty minutes", () => {
    const [candidate] = buildAutoMergeCandidates(
      [issue({
        deliveryState: "merged",
        terminalEvidence: null,
        blockerType: "tail_waiting",
      })],
      [lock({
        state: "verification_tail",
        blockerType: "tail_waiting",
      })],
      [verification({
        status: "in_progress",
        startedAt: new Date("2026-05-26T00:00:00.000Z"),
        finishedAt: null,
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
      })],
    );

    expect(candidate).toMatchObject({
      implementationSlot: "released",
      verificationTail: "tail_waiting",
    });
    expect(candidate?.reasons).not.toContain("issue_blocker:tail_waiting");
  });
});

describe("buildFeatureBackfillCandidates", () => {
  it("turns open feature issues into ranked native features", () => {
    const candidates = buildFeatureBackfillCandidates(
      [
        issue({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          category: "feature",
          status: "todo",
          deliveryState: "queued_repo_gate",
          identifier: "SOU-42",
          title: "Prioritize feature board",
          surfaces: ["dashboard"],
          nextAction: "CTO selects the next delivery slot.",
          updatedAt: new Date("2026-05-26T03:00:00.000Z"),
        }),
      ],
      [],
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        featureId: "SOU-42",
        title: "Prioritize feature board",
        intakeStatus: "queued",
        priorityRank: 1,
        productArea: "dashboard",
        repo: "dashboard",
        rootIssueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        nextAction: "CTO selects the next delivery slot.",
      }),
    ]);
  });

  it("backfills uncategorized issues owned by feature agents", () => {
    const candidates = buildFeatureBackfillCandidates(
      [
        issue({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          category: "uncategorized",
          status: "backlog",
          identifier: "SOU-44",
          title: "[Desktop] Add delivery rail controls",
          assigneeAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ],
      [],
      [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Dev Feature" }] as any,
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        featureId: "SOU-44",
        intakeStatus: "ready_for_priority",
      }),
    ]);
  });

  it("keeps process and security issues out of the feature board", () => {
    const candidates = buildFeatureBackfillCandidates(
      [
        issue({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          category: "uncategorized",
          status: "backlog",
          identifier: "SOU-44",
          title: "[Security Review] Patch dashboard auth findings",
          assigneeAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
        issue({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          category: "uncategorized",
          status: "backlog",
          identifier: "SOU-45",
          title: "Routine — Repo Steward / Worktree Janitor",
          assigneeAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ],
      [],
      [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Dev Feature" }] as any,
    );

    expect(candidates).toHaveLength(0);
  });

  it("skips closed issues and issues that already have a native feature", () => {
    const candidates = buildFeatureBackfillCandidates(
      [
        issue({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          category: "feature",
          status: "done",
          identifier: "SOU-42",
        }),
        issue({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          category: "feature",
          status: "backlog",
          identifier: "SOU-43",
        }),
      ],
      [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          featureId: "SOU-43",
          rootIssueId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          priorityRank: 7,
        },
      ] as any,
    );

    expect(candidates).toHaveLength(0);
  });
});
