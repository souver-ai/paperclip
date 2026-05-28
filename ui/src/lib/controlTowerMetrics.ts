import {
  featureBucket,
  FEATURE_DELIVERED_DELIVERY_STATES,
  type AutoMergeCandidate,
  type Feature,
  type HarnessFinding,
  type Issue,
  type RepoLock,
  type TestCase,
  type VerificationRun,
} from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

export type WindowKey = "24h" | "7d" | "30d";

export const WINDOW_OPTIONS: { key: WindowKey; label: string }[] = [
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 j" },
  { key: "30d", label: "30 j" },
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const WINDOW_MS: Record<WindowKey, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

// Number of buckets used to draw the trend sparkline for a given window.
const TREND_BUCKETS: Record<WindowKey, number> = {
  "24h": 12,
  "7d": 7,
  "30d": 30,
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Data health — the core resilience primitive.
//
// Because part of this data is produced by agents, an empty panel is ambiguous:
// it can mean "genuinely zero" (the producer ran, nothing to report) or
// "unknown" (no producer has ever written here, or it went silent). We make
// that distinction explicit instead of rendering both as a blank panel.
// ---------------------------------------------------------------------------

export type HealthState = "ok" | "stale" | "empty";

export interface DataHealth {
  /** "empty" = no record ever (unknown). "stale" = producer silent past threshold. "ok" = fresh. */
  state: HealthState;
  /** total records known to the source (any age) */
  total: number;
  /** most recent producer activity */
  lastActivityAt: number | null;
  /** age of last activity in ms (null when empty) */
  ageMs: number | null;
  /** staleness threshold used, in ms */
  staleAfterMs: number;
}

export function dataHealth(
  timestamps: (Date | string | null | undefined)[],
  now: number,
  staleAfterMs: number,
): DataHealth {
  const ms = timestamps.map(toMs).filter((v): v is number => v != null);
  if (ms.length === 0) {
    return { state: "empty", total: 0, lastActivityAt: null, ageMs: null, staleAfterMs };
  }
  const lastActivityAt = Math.max(...ms);
  const ageMs = now - lastActivityAt;
  return {
    state: ageMs > staleAfterMs ? "stale" : "ok",
    total: ms.length,
    lastActivityAt,
    ageMs,
    staleAfterMs,
  };
}

// ---------------------------------------------------------------------------
// KPI model
// ---------------------------------------------------------------------------

export type KpiMode = "window" | "snapshot";
export type KpiConfidence = "measured" | "proxy";

export interface Kpi {
  key: string;
  label: string;
  /** count in the active window (window mode) or current snapshot count (snapshot mode) */
  value: number;
  /** count in the immediately-preceding equal window; null for snapshot KPIs */
  previous: number | null;
  mode: KpiMode;
  /** "measured" = real per-record timestamp; "proxy" = derived/best-effort until GitHub truth lands */
  confidence: KpiConfidence;
  health: DataHealth;
  /** in-app deep link to the detail view, pre-scoped where possible */
  href: string;
  /** producer responsible for this flow (shown in empty/stale states) */
  producer: string;
  /** per-bucket counts across the window for a sparkline (window mode only) */
  trend: number[];
  /** short note shown under proxy KPIs */
  note?: string;
}

const DELIVERED_STATES = new Set<string>(FEATURE_DELIVERED_DELIVERY_STATES);
const PR_OPEN_STATES = new Set<string>([
  "pr_ready",
  "in_review",
  "changes_requested",
  "merge_ready",
]);

function isOpenIssue(issue: Issue): boolean {
  return issue.status !== "done" && issue.status !== "cancelled" && (issue as { hiddenAt?: unknown }).hiddenAt == null;
}

function countInWindow(
  timestamps: (Date | string | null | undefined)[],
  windowStart: number,
  windowEnd: number,
): number {
  let n = 0;
  for (const t of timestamps) {
    const ms = toMs(t);
    if (ms != null && ms >= windowStart && ms < windowEnd) n += 1;
  }
  return n;
}

function trendBuckets(
  timestamps: (Date | string | null | undefined)[],
  windowStart: number,
  now: number,
  buckets: number,
): number[] {
  const span = now - windowStart;
  const size = span / buckets;
  const out = new Array<number>(buckets).fill(0);
  if (size <= 0) return out;
  for (const t of timestamps) {
    const ms = toMs(t);
    if (ms == null || ms < windowStart || ms > now) continue;
    const idx = Math.min(buckets - 1, Math.floor((ms - windowStart) / size));
    out[idx] += 1;
  }
  return out;
}

export interface ControlTowerData {
  issues: Issue[];
  testCases: TestCase[];
  features: Feature[];
  harnessFindings: HarnessFinding[];
  autoMergeCandidates: AutoMergeCandidate[];
  repoLocks: RepoLock[];
  verificationRuns: VerificationRun[];
}

/**
 * Compute the Delivery Pulse KPI strip.
 *
 * `now` is injected (not read from the clock) so the function is pure and
 * deterministically testable.
 */
export function computePulse(data: ControlTowerData, window: WindowKey, now: number): Kpi[] {
  const span = WINDOW_MS[window];
  const windowStart = now - span;
  const prevStart = now - 2 * span;
  const buckets = TREND_BUCKETS[window];

  // 1. New tests created — measured (real createdAt).
  const testTimestamps = data.testCases.map((t) => t.createdAt);
  const newTests: Kpi = {
    key: "new-tests",
    label: "Nouveaux tests",
    value: countInWindow(testTimestamps, windowStart, now),
    previous: countInWindow(testTimestamps, prevStart, windowStart),
    mode: "window",
    confidence: "measured",
    health: dataHealth(testTimestamps, now, 14 * DAY_MS),
    href: "/tests",
    producer: "Test Architect",
    trend: trendBuckets(testTimestamps, windowStart, now, buckets),
  };

  // 2. PRs in flight — snapshot of open issues in a PR delivery state.
  const openPrIssues = data.issues.filter(
    (i) => isOpenIssue(i) && i.deliveryState != null && PR_OPEN_STATES.has(i.deliveryState),
  );
  const prsOpen: Kpi = {
    key: "prs-open",
    label: "PR en cours",
    value: openPrIssues.length,
    previous: null,
    mode: "snapshot",
    confidence: "proxy",
    health: dataHealth(
      data.issues.map((i) => i.updatedAt),
      now,
      2 * DAY_MS,
    ),
    href: "#repos",
    producer: "CTO · GitHub sync (P1)",
    trend: [],
    note: "Source: état de livraison Paperclip — vérité GitHub en P1.",
  };

  // 3. PRs merged — proxy: issues that reached a merged delivery state, stamped
  // into the window by updatedAt. Replaced by GitHub merge events in P1.
  const mergedIssues = data.issues.filter(
    (i) => i.deliveryState != null && DELIVERED_STATES.has(i.deliveryState),
  );
  const mergedTimestamps = mergedIssues.map((i) => i.updatedAt);
  const prsMerged: Kpi = {
    key: "prs-merged",
    label: "PR mergées",
    value: countInWindow(mergedTimestamps, windowStart, now),
    previous: countInWindow(mergedTimestamps, prevStart, windowStart),
    mode: "window",
    confidence: "proxy",
    health: dataHealth(mergedTimestamps, now, 7 * DAY_MS),
    href: "/features",
    producer: "Delivery gate · GitHub sync (P1)",
    trend: trendBuckets(mergedTimestamps, windowStart, now, buckets),
    note: "Fenêtré sur la dernière transition — vérité GitHub en P1.",
  };

  // 4. PRs awaiting merge — snapshot of candidates ready but not yet merged.
  const awaiting = data.autoMergeCandidates.filter(
    (c) =>
      Boolean(c.prUrl) &&
      !DELIVERED_STATES.has(c.deliveryState) &&
      (c.deliveryState === "merge_ready" || c.eligible),
  );
  const prsAwaiting: Kpi = {
    key: "prs-awaiting",
    label: "En attente de merge",
    value: awaiting.length,
    previous: null,
    mode: "snapshot",
    confidence: "measured",
    health: dataHealth(
      data.autoMergeCandidates.map((c) => c.latestVerificationAt),
      now,
      2 * DAY_MS,
    ),
    href: "#auto-merge",
    producer: "Delivery gatekeeper",
    trend: [],
  };

  // 5. Features delivered — proxy: features in a delivered bucket, windowed by
  // updatedAt (no explicit deliveredAt timestamp yet).
  const deliveredFeatures = data.features.filter(
    (f) => featureBucket(f.intakeStatus, f.deliveryState, f.title) === "delivered",
  );
  const deliveredTimestamps = deliveredFeatures.map((f) => f.updatedAt);
  const featuresDelivered: Kpi = {
    key: "features-delivered",
    label: "Features livrées",
    value: countInWindow(deliveredTimestamps, windowStart, now),
    previous: countInWindow(deliveredTimestamps, prevStart, windowStart),
    mode: "window",
    confidence: "proxy",
    health: dataHealth(
      data.features.map((f) => f.updatedAt),
      now,
      14 * DAY_MS,
    ),
    href: "/features",
    producer: "PM / CTO",
    trend: trendBuckets(deliveredTimestamps, windowStart, now, buckets),
    note: "Fenêtré sur la dernière mise à jour de la feature.",
  };

  // 6. Harness hypotheses generated — measured (real createdAt of findings).
  const findingTimestamps = data.harnessFindings.map((h) => h.createdAt);
  const harnessHypotheses: Kpi = {
    key: "harness-hypotheses",
    label: "Hypothèses harness",
    value: countInWindow(findingTimestamps, windowStart, now),
    previous: countInWindow(findingTimestamps, prevStart, windowStart),
    mode: "window",
    confidence: "measured",
    health: dataHealth(findingTimestamps, now, 14 * DAY_MS),
    href: "/harness",
    producer: "Harness Analyst",
    trend: trendBuckets(findingTimestamps, windowStart, now, buckets),
  };

  return [newTests, prsOpen, prsMerged, prsAwaiting, featuresDelivered, harnessHypotheses];
}

// ---------------------------------------------------------------------------
// Source health row — who feeds each flow, and when it last spoke.
// ---------------------------------------------------------------------------

export interface SourceHealth {
  key: string;
  label: string;
  producer: string;
  health: DataHealth;
}

export function computeSourceHealth(data: ControlTowerData, now: number): SourceHealth[] {
  return [
    {
      key: "tests",
      label: "Tests",
      producer: "Test Architect",
      health: dataHealth(
        data.testCases.map((t) => t.updatedAt),
        now,
        14 * DAY_MS,
      ),
    },
    {
      key: "evidence",
      label: "Evidence",
      producer: "Test Architect / CI",
      health: dataHealth(
        data.verificationRuns.map((r) => r.finishedAt ?? r.createdAt),
        now,
        3 * DAY_MS,
      ),
    },
    {
      key: "features",
      label: "Features",
      producer: "PM / CTO",
      health: dataHealth(
        data.features.map((f) => f.updatedAt),
        now,
        14 * DAY_MS,
      ),
    },
    {
      key: "harness",
      label: "Harness",
      producer: "Harness Analyst",
      health: dataHealth(
        data.harnessFindings.map((h) => h.createdAt),
        now,
        14 * DAY_MS,
      ),
    },
    {
      key: "repos",
      label: "Repos / PRs",
      producer: "CTO · GitHub sync",
      health: dataHealth(
        data.repoLocks.map((l) => l.updatedAt),
        now,
        2 * DAY_MS,
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Attention queue — only what needs a human or an agent to act, ranked.
// ---------------------------------------------------------------------------

export type AttentionSeverity = "danger" | "warning" | "info";

export interface AttentionItem {
  key: string;
  severity: AttentionSeverity;
  category: string;
  title: string;
  detail: string;
  href?: string;
  /** external PR link */
  prUrl?: string | null;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { danger: 0, warning: 1, info: 2 };

export function computeAttentionQueue(
  data: ControlTowerData,
  sourceHealth: SourceHealth[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Failed / blocked evidence.
  for (const run of data.verificationRuns) {
    if (run.status === "fail" || run.status === "blocked") {
      items.push({
        key: `evidence-${run.id}`,
        severity: "danger",
        category: "Evidence",
        title: run.verdictSummary ?? run.command ?? "Verification en échec",
        detail: [run.repo, run.failureCategory, run.nextAction].filter(Boolean).join(" · ") || run.status,
        prUrl: run.prUrl,
      });
    }
  }

  // PRs blocked at the merge gate.
  for (const c of data.autoMergeCandidates) {
    if (!c.eligible && c.reasons.length > 0 && !DELIVERED_STATES.has(c.deliveryState)) {
      items.push({
        key: `merge-${c.issueId}`,
        severity: "warning",
        category: "Merge gate",
        title: `${c.identifier ?? c.issueId.slice(0, 8)} · ${c.title}`,
        detail: c.nextAction ?? c.reasons.join(", "),
        prUrl: c.prUrl,
      });
    }
  }

  // Benjamin approvals.
  for (const issue of data.issues) {
    if (issue.benjaminRequired && isOpenIssue(issue)) {
      items.push({
        key: `benjamin-${issue.id}`,
        severity: "danger",
        category: "Benjamin",
        title: `${issue.identifier ?? issue.id.slice(0, 8)} · ${issue.title}`,
        detail: issue.nextAction ?? "Décision requise",
      });
    }
  }

  // Silent / never-seen producers (resilience signal).
  for (const src of sourceHealth) {
    if (src.health.state === "empty") {
      items.push({
        key: `producer-${src.key}-empty`,
        severity: "warning",
        category: "Producteur",
        title: `${src.label} — aucune donnée`,
        detail: `Producteur attendu : ${src.producer}. Rien n'a jamais été publié ici.`,
      });
    } else if (src.health.state === "stale") {
      items.push({
        key: `producer-${src.key}-stale`,
        severity: "info",
        category: "Producteur",
        title: `${src.label} — silencieux`,
        detail: `${src.producer} n'a rien publié depuis ${formatAge(src.health.ageMs)}.`,
      });
    }
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return items;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatAge(ageMs: number | null): string {
  if (ageMs == null) return "jamais";
  if (ageMs < HOUR_MS) return `${Math.max(1, Math.round(ageMs / (60 * 1000)))} min`;
  if (ageMs < DAY_MS) return `${Math.round(ageMs / HOUR_MS)} h`;
  return `${Math.round(ageMs / DAY_MS)} j`;
}

export function deltaLabel(kpi: Kpi): string | null {
  if (kpi.mode !== "window" || kpi.previous == null) return null;
  const diff = kpi.value - kpi.previous;
  if (diff === 0) return "=";
  return diff > 0 ? `+${diff}` : `${diff}`;
}
