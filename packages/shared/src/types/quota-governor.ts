/** quota-governor health band relative to the target burn trajectory */
export type QuotaGovernorBand = "under_target" | "on_target" | "over_target" | "unknown";

/** forecast confidence derived from elapsed period and observed spend */
export type ForecastConfidence = "low" | "medium" | "high";

/** effect of the current cadence on the target trajectory */
export type QuotaGovernorCadenceEffect = "helping" | "hurting" | "neutral" | "unknown";

/** one cadence driver (routine or heartbeat) contributing to spend */
export interface QuotaGovernorDriver {
  kind: string;
  id?: string;
  name: string;
  cadence: string;
  runsPerDay: number;
  observedSpendCents: number;
  enabled?: boolean;
  status?: string | null;
  criticality?: "critical" | "non_critical" | "unknown";
}

export interface QuotaGovernorCadenceChange {
  targetType: "heartbeat" | "routine_trigger";
  targetId: string;
  targetName: string;
  field: string;
  previousValue: string | number | boolean | null;
  nextValue: string | number | boolean | null;
  reason: string;
  actor: string;
  source: string;
  createdAt: string;
  applied: boolean;
}

export interface QuotaGovernorCadenceSnapshot {
  heartbeats: QuotaGovernorDriver[];
  routines: QuotaGovernorDriver[];
}

export interface QuotaGovernorForecast {
  elapsedDays: number;
  remainingDays: number;
  providerUsedPercent: number | null;
  projectedUsagePercent: number;
  thresholdPercent: number;
  confidence: ForecastConfidence;
  resetAt: string | null;
  windowStartAt: string | null;
  quotaLimitCents: number | null;
  usageCents: number;
}

/** parsed snapshot of the latest Paperclip quota-governor report */
export interface QuotaGovernorSnapshot {
  id?: string;
  reportPath: string;
  generatedAt: string | null;
  status: string;
  summary: string;
  quotaSource: string;
  spentCents: number;
  quotaCents: number;
  remainingCents: number;
  elapsedDays: number;
  remainingDays: number;
  dailyBurnCents: number;
  projectedEndCents: number;
  projectedUtilization: number;
  targetUtilization: number;
  targetCents: number;
  safetyBand: number;
  band: QuotaGovernorBand;
  confidence: ForecastConfidence;
  cadenceEffect: QuotaGovernorCadenceEffect;
  recommendationAction: string;
  recommendationSummary: string;
  recommendationRationale: string;
  approvalRequired: boolean;
  drivers: QuotaGovernorDriver[];
  resetAt?: string | null;
  windowStartAt?: string | null;
  quotaUsedPercent?: number | null;
  forecast?: QuotaGovernorForecast;
  cadenceSnapshot?: QuotaGovernorCadenceSnapshot;
  cadenceChanges?: QuotaGovernorCadenceChange[];
  error?: string | null;
}

/** envelope returned by the quota-governor endpoint */
export interface QuotaGovernorLoadResult {
  snapshot: QuotaGovernorSnapshot | null;
  history?: QuotaGovernorSnapshot[];
  reportDir: string;
  error?: string;
}
