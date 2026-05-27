/** quota-governor health band relative to the target burn trajectory */
export type QuotaGovernorBand = "under_target" | "on_target" | "over_target" | "unknown";

/** forecast confidence derived from elapsed period and observed spend */
export type ForecastConfidence = "low" | "medium" | "high";

/** effect of the current cadence on the target trajectory */
export type QuotaGovernorCadenceEffect = "helping" | "hurting" | "neutral" | "unknown";

/** one cadence driver (routine or heartbeat) contributing to spend */
export interface QuotaGovernorDriver {
  kind: string;
  name: string;
  cadence: string;
  runsPerDay: number;
  observedSpendCents: number;
}

/** parsed snapshot of the latest Paperclip quota-governor report */
export interface QuotaGovernorSnapshot {
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
}

/** envelope returned by the quota-governor endpoint */
export interface QuotaGovernorLoadResult {
  snapshot: QuotaGovernorSnapshot | null;
  reportDir: string;
  error?: string;
}
