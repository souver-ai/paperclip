import type {
  BlockerType,
  DeliveryState,
  FeatureIntakeStatus,
  FeatureRiskLevel,
  FeatureSourceTeam,
  HarnessFindingSeverity,
  HarnessFindingStatus,
  HarnessRunStatus,
  IssueSurface,
  RepoLockState,
  VerificationFailureCategory,
  VerificationRunStatus,
  VerificationRunType,
  TestCaseLastStatus,
  TestCaseSource,
  TestCaseStatus,
  TestCaseTrigger,
  TestCaseType,
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

export interface TestCase {
  id: string;
  companyId: string;
  stableKey: string;
  title: string;
  repo: IssueSurface | string | null;
  productArea: string | null;
  featureIds: string[];
  issueIds: string[];
  type: TestCaseType;
  trigger: TestCaseTrigger;
  command: string | null;
  owner: string | null;
  environment: string | null;
  riskCovered: string | null;
  requiredForDelivery: boolean;
  visibleRunnable: boolean;
  expectedDurationSec: number | null;
  status: TestCaseStatus;
  source: TestCaseSource;
  sourcePath: string | null;
  lastRunId: string | null;
  lastStatus: TestCaseLastStatus | null;
  lastRunAt: Date | null;
  lastCommitSha: string | null;
  lastBranch: string | null;
  lastPrUrl: string | null;
  artifactRefs: string[];
  gapIssueId: string | null;
  flakyReason: string | null;
  waiver: Record<string, unknown> | null;
  nextAction: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestCaseBackfillSummary {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  byRepo: Record<string, number>;
  byType: Record<string, number>;
  byLastStatus: Record<string, number>;
  sourcesRead: string[];
  sourcesMissing: string[];
  gaps: string[];
  tests: TestCase[];
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

export interface Feature {
  id: string;
  companyId: string;
  featureId: string;
  title: string;
  sourceTeam: FeatureSourceTeam;
  intakeStatus: FeatureIntakeStatus;
  priorityRank: number | null;
  pmBrief: Record<string, unknown>;
  whyNow: string | null;
  impactEstimate: string | null;
  effortEstimate: string | null;
  riskLevel: FeatureRiskLevel;
  productArea: string;
  repo: IssueSurface | string | null;
  rootIssueId: string | null;
  deliveryState: DeliveryState;
  requiredEvidence: string[];
  terminalEvidence: Record<string, unknown> | null;
  nextAction: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeaturePriorityEvent {
  id: string;
  companyId: string;
  featureId: string;
  fromRank: number | null;
  toRank: number | null;
  changedBy: string | null;
  reason: string | null;
  previousIntakeStatus: FeatureIntakeStatus | null;
  newIntakeStatus: FeatureIntakeStatus | null;
  createdAt: Date;
}

export interface AutoMergeCandidate {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  deliveryState: DeliveryState;
  repo: IssueSurface | string | null;
  branch: string | null;
  prUrl: string | null;
  repoLockId: string | null;
  repoLockState: RepoLockState | null;
  blockerType: BlockerType | null;
  benjaminRequired: boolean;
  storedAutoMergeEligible: boolean;
  eligible: boolean;
  reasons: string[];
  passedVerificationCount: number;
  failedVerificationCount: number;
  latestVerificationAt: Date | null;
  securityStatus: VerificationRunStatus | "not_recorded" | null;
  nextAction: string | null;
}
