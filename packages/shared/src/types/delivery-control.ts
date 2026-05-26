import type {
  BlockerType,
  DeliveryState,
  HarnessFindingSeverity,
  HarnessFindingStatus,
  HarnessRunStatus,
  IssueSurface,
  RepoLockState,
  VerificationFailureCategory,
  VerificationRunStatus,
  VerificationRunType,
} from "../constants.js";

export interface RepoLock {
  id: string;
  companyId: string;
  repo: IssueSurface | string;
  state: RepoLockState;
  activeIssueId: string | null;
  branch: string | null;
  prUrl: string | null;
  ownerAgentId: string | null;
  nextAction: string | null;
  blockerType: BlockerType | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationRun {
  id: string;
  companyId: string;
  issueId: string | null;
  featureId: string | null;
  repo: IssueSurface | string | null;
  type: VerificationRunType;
  status: VerificationRunStatus;
  command: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationSec: number | null;
  commitSha: string | null;
  branch: string | null;
  prUrl: string | null;
  artifactPaths: string[];
  verdictSummary: string | null;
  failureCategory: VerificationFailureCategory | null;
  nextAction: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HarnessRun {
  id: string;
  companyId: string;
  issueId: string | null;
  experimentId: string | null;
  benchmarkName: string | null;
  model: string | null;
  status: HarnessRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationSec: number | null;
  score: string | null;
  reportPath: string | null;
  artifactPaths: string[];
  verdictSummary: string | null;
  nextAction: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HarnessFinding {
  id: string;
  companyId: string;
  harnessRunId: string | null;
  issueId: string | null;
  title: string;
  severity: HarnessFindingSeverity;
  status: HarnessFindingStatus;
  failureCategory: VerificationFailureCategory | null;
  evidence: Record<string, unknown>;
  antiRecurrencePatternId: string | null;
  nextAction: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentThroughput {
  agentId: string;
  name: string;
  role: string;
  status: string;
  lastHeartbeatAt: Date | null;
  assignedOpenIssues: number;
  assignedBlockedIssues: number;
  assignedInReviewIssues: number;
  createdIssues7d: number;
  completedIssues7d: number;
  runs24h: number;
  successfulRuns24h: number;
  failedRuns24h: number;
  productiveRuns24h: number;
  planOnlyRuns24h: number;
  blockedRuns24h: number;
  activityEvents24h: number;
  lastRunAt: Date | null;
}
