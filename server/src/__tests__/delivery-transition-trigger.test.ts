import { describe, expect, it } from "vitest";
import {
  buildDeliveryTransitionWakeup,
  findDeliveryTransitionAgent,
  isDeliveryTransitionReconcileCandidate,
  resolveDeliveryTransitionRoute,
} from "../services/delivery-transition-trigger.js";

const baseIssue = {
  id: "issue-1",
  companyId: "company-1",
  identifier: "PAP-1",
  title: "Ship feature",
  status: "in_review",
  deliveryState: "pr_ready",
  blockerType: null,
  benjaminRequired: false,
  assigneeAgentId: "agent-dev",
};

const agents = [
  { id: "agent-dev", name: "Dev Feature", status: "idle" },
  { id: "agent-test", name: "Test Architect", status: "idle" },
  { id: "agent-cto", name: "CTO", status: "idle" },
  { id: "agent-gate", name: "Delivery Gatekeeper", status: "idle" },
];

describe("delivery transition trigger", () => {
  it("routes merge_ready transitions to CTO", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: baseIssue,
      nextDeliveryState: "merge_ready",
      agents,
    });

    expect(route).toMatchObject({
      fromState: "pr_ready",
      toState: "merge_ready",
      targetAgentName: "CTO",
      targetAgentId: "agent-cto",
      wakeReason: "delivery_merge_ready",
    });
  });

  it("routes merged transitions to Delivery Gatekeeper for target verification", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: { ...baseIssue, deliveryState: "merge_ready" },
      nextDeliveryState: "merged",
      agents,
    });

    expect(route).toMatchObject({
      targetAgentName: "Delivery Gatekeeper",
      targetAgentId: "agent-gate",
      wakeReason: "delivery_merged_verification_required",
    });
  });

  it("does not route human gates as machine transitions", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: { ...baseIssue, deliveryState: "blocked" },
      nextDeliveryState: "merge_ready",
      nextBlockerType: "approval_benjamin",
      nextBenjaminRequired: true,
      agents,
    });

    expect(route).toBeNull();
  });

  it("can reconcile an already-actionable delivery state to its owner", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: { ...baseIssue, deliveryState: "changes_requested" },
      nextDeliveryState: "changes_requested",
      agents,
      allowCurrentState: true,
    });

    expect(route).toMatchObject({
      fromState: "changes_requested",
      toState: "changes_requested",
      targetAgentName: "Dev Feature",
      targetAgentId: "agent-dev",
      wakeReason: "delivery_changes_requested",
    });
  });

  it("does not reconcile current-state delivery unless explicitly allowed", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: { ...baseIssue, deliveryState: "changes_requested" },
      nextDeliveryState: "changes_requested",
      agents,
    });

    expect(route).toBeNull();
  });

  it("marks stale machine-actionable delivery states as reconcile candidates", () => {
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "in_review",
      deliveryState: "merge_ready",
      assigneeAgentId: "agent-dev",
    })).toBe(true);
  });

  it("routes mechanical repo blockers to CTO even when delivery state stays intake", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: { ...baseIssue, deliveryState: "intake", blockerType: null },
      nextDeliveryState: "intake",
      nextBlockerType: "repo_dirty",
      agents,
    });

    expect(route).toMatchObject({
      fromState: "intake",
      toState: "intake",
      targetAgentName: "CTO",
      targetAgentId: "agent-cto",
      wakeReason: "delivery_repo_gate",
    });
  });

  it("marks mechanical repo blockers as reconcile candidates", () => {
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "in_review",
      deliveryState: "intake",
      blockerType: "preflight_failed",
    })).toBe(true);
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "blocked",
      deliveryState: "intake",
      blockerType: "repo_dirty",
    })).toBe(true);
  });

  it("does not reconcile blocked delivery states through the machine delivery lane", () => {
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "blocked",
      deliveryState: "merge_ready",
      assigneeAgentId: "agent-dev",
    })).toBe(false);
  });

  it("does not reconcile human protected delivery gates", () => {
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "in_review",
      deliveryState: "merge_ready",
      blockerType: "approval_benjamin",
      benjaminRequired: true,
    })).toBe(false);
    expect(isDeliveryTransitionReconcileCandidate({
      ...baseIssue,
      status: "in_review",
      deliveryState: "parked_hold",
    })).toBe(false);
  });

  it("builds a scoped wakeup payload for the routed agent", () => {
    const route = resolveDeliveryTransitionRoute({
      previousIssue: baseIssue,
      nextDeliveryState: "merge_ready",
      agents,
    });

    expect(route).not.toBeNull();
    const wakeup = buildDeliveryTransitionWakeup({
      issue: { ...baseIssue, deliveryState: "merge_ready", assigneeAgentId: "agent-cto" },
      route: route!,
      requestedByActorType: "agent",
      requestedByActorId: "agent-dev",
    });

    expect(wakeup).toMatchObject({
      agentId: "agent-cto",
      wakeup: {
        source: "automation",
        triggerDetail: "system",
        reason: "delivery_merge_ready",
        payload: {
          issueId: "issue-1",
          deliveryTransitionWake: true,
          forceImmediateIssueWake: true,
          fromDeliveryState: "pr_ready",
          toDeliveryState: "merge_ready",
        },
        contextSnapshot: {
          taskId: "issue-1",
          deliveryTransitionWake: true,
          forceImmediateIssueWake: true,
          wakeReason: "delivery_merge_ready",
        },
      },
    });
  });

  it("ignores terminated agents when resolving target names", () => {
    expect(findDeliveryTransitionAgent([
      { id: "dead", name: "CTO", status: "terminated" },
    ], "CTO")).toBeNull();
  });
});
