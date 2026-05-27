type WakeupTriggerDetail = "manual" | "ping" | "callback" | "system";
type WakeupSource = "timer" | "assignment" | "on_demand" | "automation";

export interface DeliveryTransitionAgent {
  id: string;
  name: string;
  status?: string | null;
}

export interface DeliveryTransitionIssue {
  id: string;
  companyId: string;
  identifier?: string | null;
  title?: string | null;
  status: string;
  deliveryState: string;
  blockerType?: string | null;
  benjaminRequired?: boolean | null;
  assigneeAgentId?: string | null;
}

export interface DeliveryTransitionRoute {
  fromState: string;
  toState: string;
  targetAgentName: string;
  targetAgentId: string | null;
  wakeReason: string;
}

export interface DeliveryTransitionWakeup {
  agentId: string;
  wakeup: {
    source: WakeupSource;
    triggerDetail: WakeupTriggerDetail;
    reason: string;
    payload: Record<string, unknown>;
    requestedByActorType?: "user" | "agent" | "system";
    requestedByActorId?: string | null;
    contextSnapshot: Record<string, unknown>;
  };
}

const DELIVERY_TRANSITION_TARGETS: Record<string, { agentName: string; wakeReason: string }> = {
  pr_ready: {
    agentName: "Test Architect",
    wakeReason: "delivery_pr_ready",
  },
  changes_requested: {
    agentName: "Dev Feature",
    wakeReason: "delivery_changes_requested",
  },
  merge_ready: {
    agentName: "CTO",
    wakeReason: "delivery_merge_ready",
  },
  merged: {
    agentName: "Delivery Gatekeeper",
    wakeReason: "delivery_merged_verification_required",
  },
  target_verifying: {
    agentName: "Delivery Gatekeeper",
    wakeReason: "delivery_target_verifying",
  },
};

const HUMAN_GATE_STATES = new Set([
  "merged_verified",
  "live_verified",
  "waived_by_benjamin",
  "parked_hold",
]);

function normalizeAgentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findDeliveryTransitionAgent(
  agents: DeliveryTransitionAgent[],
  targetAgentName: string,
) {
  const wanted = normalizeAgentName(targetAgentName);
  return agents.find((agent) => {
    if (agent.status === "terminated") return false;
    return normalizeAgentName(agent.name) === wanted;
  }) ?? null;
}

export function resolveDeliveryTransitionRoute(input: {
  previousIssue: DeliveryTransitionIssue;
  nextDeliveryState: string;
  nextBlockerType?: string | null;
  nextBenjaminRequired?: boolean | null;
  agents: DeliveryTransitionAgent[];
  allowCurrentState?: boolean;
}): DeliveryTransitionRoute | null {
  const fromState = input.previousIssue.deliveryState;
  const toState = input.nextDeliveryState;
  if (!toState || (!input.allowCurrentState && fromState === toState)) return null;
  if (HUMAN_GATE_STATES.has(toState)) return null;
  if (input.nextBenjaminRequired === true || input.nextBlockerType === "approval_benjamin") return null;

  const target = DELIVERY_TRANSITION_TARGETS[toState];
  if (!target) return null;

  const agent = findDeliveryTransitionAgent(input.agents, target.agentName);
  return {
    fromState,
    toState,
    targetAgentName: target.agentName,
    targetAgentId: agent?.id ?? null,
    wakeReason: target.wakeReason,
  };
}

export function buildDeliveryTransitionWakeup(input: {
  issue: DeliveryTransitionIssue;
  route: DeliveryTransitionRoute;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
}): DeliveryTransitionWakeup | null {
  const agentId = input.route.targetAgentId ?? input.issue.assigneeAgentId ?? null;
  if (!agentId || input.issue.status === "backlog") return null;

  return {
    agentId,
    wakeup: {
      source: "automation",
      triggerDetail: "system",
      reason: input.route.wakeReason,
      payload: {
        issueId: input.issue.id,
        mutation: "delivery_state_transition",
        deliveryTransitionWake: true,
        forceImmediateIssueWake: true,
        fromDeliveryState: input.route.fromState,
        toDeliveryState: input.route.toState,
        targetAgentName: input.route.targetAgentName,
        routedAgentId: input.route.targetAgentId,
      },
      requestedByActorType: input.requestedByActorType,
      requestedByActorId: input.requestedByActorId ?? null,
      contextSnapshot: {
        issueId: input.issue.id,
        taskId: input.issue.id,
        source: "issue.delivery_state_transition",
        deliveryTransitionWake: true,
        forceImmediateIssueWake: true,
        wakeReason: input.route.wakeReason,
        fromDeliveryState: input.route.fromState,
        toDeliveryState: input.route.toState,
        targetAgentName: input.route.targetAgentName,
        routedAgentId: input.route.targetAgentId,
      },
    },
  };
}
