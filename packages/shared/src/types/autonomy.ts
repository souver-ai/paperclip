/** classification of a time bucket for the autonomy heatmap */
export type AutonomyBucketState =
  | "covered" // actionable queue + useful activity (green)
  | "incident" // actionable queue but no useful activity (red)
  | "human_gate" // only Benjamin-gated work alive (gray)
  | "idle_healthy" // nothing actionable; runtime present or quiet (yellow)
  | "absent"; // no runs and no actionable work

export type AutonomyPeriodKey = "24h" | "7d" | "30d";

export interface AutonomyKpis {
  /** useful-on-actionable coverage; null when there were no actionable minutes */
  autonomousCoveragePct: number | null;
  /** minutes with >=1 active run / calendar minutes of the period */
  raw247PresencePct: number;
  actionableBuckets: number;
  coveredBuckets: number;
  incidentBuckets: number;
  presentBuckets: number;
  totalBuckets: number;
  usefulRuns: number;
  /** estimated cost in cents over the period, null when not available */
  estimatedCostCents: number | null;
}

export interface AutonomyHeatmapCell {
  dayOfWeek: number; // 0=Sunday..6=Saturday (UTC)
  hour: number; // 0..23 (UTC)
  state: AutonomyBucketState;
}

export interface AutonomyAgentBreakdown {
  agentId: string;
  name: string;
  runs: number;
  usefulRuns: number;
  failedRuns: number;
  activeMinutes: number;
  lastOutputAt: string | null;
}

export interface AutonomyIncident {
  startedAt: string;
  durationMinutes: number;
  cause: string;
  agentId: string;
  agentName: string;
}

export interface AutonomyReport {
  period: AutonomyPeriodKey;
  periodStart: string;
  periodEnd: string;
  bucketMinutes: number;
  kpis: AutonomyKpis;
  heatmap: AutonomyHeatmapCell[];
  agents: AutonomyAgentBreakdown[];
  incidents: AutonomyIncident[];
}
