import { describe, expect, it } from "vitest";
import {
  buildDeliveryTransitionWakeup,
  findDeliveryTransitionAgent,
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
          fromDeliveryState: "pr_ready",
          toDeliveryState: "merge_ready",
        },
        contextSnapshot: {
          taskId: "issue-1",
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
