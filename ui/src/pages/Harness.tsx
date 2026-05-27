import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleDot,
  DatabaseZap,
  FlaskConical,
  GitPullRequest,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import {
  harnessBucket,
  HARNESS_BUCKETS,
  type HarnessBucket,
  type HarnessFinding,
  type HarnessItem,
  type HarnessRun,
} from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { deliveryControlApi } from "../api/deliveryControl";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "../components/ui/button";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDateTime } from "../lib/utils";

type Tone = "default" | "success" | "warning" | "danger" | "info" | "caution";

function formatLabel(value: string | null | undefined): string {
  if (!value) return "none";
  return value.replace(/_/g, " ");
}

function toneFor(value: string | null | undefined): Tone {
  if (!value) return "default";
  if (["pass", "resolved", "waived"].includes(value)) return "success";
  if (["fail", "blocked", "critical", "high"].includes(value)) return "danger";
  if (["inconclusive", "open", "triaged", "medium"].includes(value)) return "warning";
  return "default";
}

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300";
    case "caution":
      return "border-orange-500/40 bg-orange-500/5 text-orange-700 dark:text-orange-300";
    case "info":
      return "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300";
    case "danger":
      return "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

const HARNESS_BUCKET_TONE: Record<HarnessBucket, Tone> = {
  delivered: "success",
  delivered_unmerged: "caution",
  done_noncode: "default",
  in_progress: "info",
  blocked: "danger",
  queued: "warning",
  abandoned: "default",
};

const HARNESS_BUCKET_LABEL: Record<HarnessBucket, string> = {
  delivered: "Delivered",
  delivered_unmerged: "Done · unmerged",
  done_noncode: "Done (non-code)",
  in_progress: "In progress",
  blocked: "Blocked",
  queued: "Queued",
  abandoned: "Abandoned",
};

function itemBucket(item: HarnessItem): HarnessBucket {
  return harnessBucket(item.issueStatus, item.deliveryState, item.title);
}

function HarnessFilterChip({
  label,
  count,
  tone = "default",
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: Tone;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition",
        active ? toneClasses(tone) : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums text-xs opacity-80">{count}</span>
    </button>
  );
}

function ItemsTable({ items }: { items: HarnessItem[] }) {
  if (items.length === 0) {
    return (
      <div className="border border-dashed border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
        No harness work items in this view.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium">Item</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Benchmark</th>
            <th className="px-3 py-3 font-medium">Category</th>
            <th className="px-3 py-3 font-medium">Delivery</th>
            <th className="px-3 py-3 font-medium">Issue</th>
            <th className="px-3 py-3 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/70 last:border-0">
              <td className="max-w-[300px] px-3 py-3 align-top">
                <div className="font-mono text-xs text-primary">{item.itemId}</div>
                <div className="mt-1 line-clamp-2 font-medium">{item.title}</div>
              </td>
              <td className="px-3 py-3 align-top"><Pill tone={HARNESS_BUCKET_TONE[itemBucket(item)]}>{HARNESS_BUCKET_LABEL[itemBucket(item)]}</Pill></td>
              <td className="px-3 py-3 align-top text-muted-foreground">{item.benchmark ?? "none"}</td>
              <td className="px-3 py-3 align-top text-muted-foreground">{formatLabel(item.category)}</td>
              <td className="px-3 py-3 align-top"><Pill tone={toneFor(item.deliveryState)}>{formatLabel(item.deliveryState)}</Pill></td>
              <td className="px-3 py-3 align-top">{issueLink(item.rootIssueId)}</td>
              <td className="max-w-[300px] px-3 py-3 align-top">
                <div className="line-clamp-3 text-muted-foreground">{item.nextAction ?? "none"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium", toneClasses(tone))}>
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: Tone;
}) {
  return (
    <div className="border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-2 text-2xl font-semibold tabular-nums",
        tone === "success" && "text-emerald-600 dark:text-emerald-300",
        tone === "warning" && "text-amber-600 dark:text-amber-300",
        tone === "danger" && "text-red-600 dark:text-red-300",
      )}>
        {value}
      </div>
    </div>
  );
}

function issueLink(issueId: string | null) {
  if (!issueId) return <span className="text-muted-foreground">none</span>;
  return (
    <Link to={`/issues/${issueId}`} className="font-mono text-xs text-primary hover:underline">
      {issueId.slice(0, 8)}
    </Link>
  );
}

function latestFirst<T extends { createdAt: Date; updatedAt: Date }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
}

function HarnessEmptyState() {
  return (
    <div className="border border-dashed border-border bg-card">
      <EmptyState
        icon={FlaskConical}
        message="No harness runs or findings yet. Next expected producer: Harness Analyst or a Terminal-Bench loop should publish harness evidence here."
      />
    </div>
  );
}

function FindingsTable({ findings }: { findings: HarnessFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="border border-dashed border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
        No harness findings.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium">Finding</th>
            <th className="px-3 py-3 font-medium">Severity</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Category</th>
            <th className="px-3 py-3 font-medium">Issue</th>
            <th className="px-3 py-3 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id} className="border-b border-border/70 last:border-0">
              <td className="max-w-[280px] px-3 py-3 align-top">
                <div className="line-clamp-2 font-medium">{finding.title}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{finding.id.slice(0, 8)}</div>
              </td>
              <td className="px-3 py-3 align-top"><Pill tone={toneFor(finding.severity)}>{finding.severity}</Pill></td>
              <td className="px-3 py-3 align-top"><Pill tone={toneFor(finding.status)}>{formatLabel(finding.status)}</Pill></td>
              <td className="px-3 py-3 align-top text-muted-foreground">{formatLabel(finding.failureCategory)}</td>
              <td className="px-3 py-3 align-top">{issueLink(finding.issueId)}</td>
              <td className="max-w-[320px] px-3 py-3 align-top">
                <div className="line-clamp-3 text-muted-foreground">{finding.nextAction ?? "none"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ runs }: { runs: HarnessRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="border border-dashed border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
        No harness runs.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium">Run</th>
            <th className="px-3 py-3 font-medium">Benchmark</th>
            <th className="px-3 py-3 font-medium">Model</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Score</th>
            <th className="px-3 py-3 font-medium">Finished</th>
            <th className="px-3 py-3 font-medium">Issue</th>
            <th className="px-3 py-3 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-border/70 last:border-0">
              <td className="max-w-[280px] px-3 py-3 align-top">
                <div className="line-clamp-2 font-medium">{run.verdictSummary ?? run.experimentId ?? "Harness run"}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{run.experimentId ?? run.id.slice(0, 8)}</div>
              </td>
              <td className="px-3 py-3 align-top text-muted-foreground">{run.benchmarkName ?? "none"}</td>
              <td className="px-3 py-3 align-top text-muted-foreground">{run.model ?? "none"}</td>
              <td className="px-3 py-3 align-top"><Pill tone={toneFor(run.status)}>{run.status}</Pill></td>
              <td className="px-3 py-3 align-top text-muted-foreground">{run.score ?? "none"}</td>
              <td className="px-3 py-3 align-top text-muted-foreground">{run.finishedAt ? formatDateTime(run.finishedAt) : "unfinished"}</td>
              <td className="px-3 py-3 align-top">{issueLink(run.issueId)}</td>
              <td className="max-w-[300px] px-3 py-3 align-top">
                <div className="line-clamp-3 text-muted-foreground">{run.nextAction ?? "none"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Harness() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [bucketFilter, setBucketFilter] = useState<HarnessBucket | "all">("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Work", href: "/issues" }, { label: "Harness" }]);
  }, [setBreadcrumbs]);

  const harnessRunsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.harnessRuns(selectedCompanyId) : ["delivery-control", "harness-runs", "__disabled__"],
    queryFn: () => deliveryControlApi.listHarnessRuns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const harnessItemsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.harnessItems(selectedCompanyId) : ["delivery-control", "harness-items", "__disabled__"],
    queryFn: () => deliveryControlApi.listHarnessItems(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const harnessFindingsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.harnessFindings(selectedCompanyId) : ["delivery-control", "harness-findings", "__disabled__"],
    queryFn: () => deliveryControlApi.listHarnessFindings(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const backfillMutation = useMutation({
    mutationFn: () => deliveryControlApi.backfillHarnessItemsFromIssues(selectedCompanyId!),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.harnessItems(selectedCompanyId) });
      }
    },
  });

  const items = useMemo(() => latestFirst(harnessItemsQuery.data ?? []), [harnessItemsQuery.data]);
  const itemBucketCounts = useMemo(() => {
    const counts = Object.fromEntries(HARNESS_BUCKETS.map((bucket) => [bucket, 0])) as Record<HarnessBucket, number>;
    for (const item of items) counts[itemBucket(item)] += 1;
    return counts;
  }, [items]);
  const visibleItems = useMemo(
    () => (bucketFilter === "all" ? items : items.filter((item) => itemBucket(item) === bucketFilter)),
    [items, bucketFilter],
  );
  const runs = useMemo(() => latestFirst(harnessRunsQuery.data ?? []), [harnessRunsQuery.data]);
  const findings = useMemo(() => latestFirst(harnessFindingsQuery.data ?? []), [harnessFindingsQuery.data]);
  const openFindings = findings.filter((finding) => !["resolved", "waived"].includes(finding.status));
  const failedRuns = runs.filter((run) => run.status === "fail" || run.status === "blocked");
  const passRuns = runs.filter((run) => run.status === "pass");
  const hasHarnessData = runs.length > 0 || findings.length > 0;

  if (!selectedCompanyId) {
    return companies.length === 0
      ? <EmptyState icon={FlaskConical} message="Create a company to open Harness." />
      : <EmptyState icon={FlaskConical} message="Select a company to open Harness." />;
  }

  if (harnessRunsQuery.isLoading || harnessFindingsQuery.isLoading || harnessItemsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Harness</h1>
          <p className="mt-1 text-sm text-muted-foreground">Experiments, runs, findings, and next actions from agent evaluation loops.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => backfillMutation.mutate()}
          disabled={backfillMutation.isPending}
        >
          <DatabaseZap className="h-4 w-4" />
          {backfillMutation.isPending ? "Backfilling..." : "Backfill"}
        </Button>
        {harnessRunsQuery.error || harnessFindingsQuery.error ? (
          <div className="flex items-center gap-2 border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Harness data failed to load.</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Runs" value={runs.length} />
        <Metric label="Passing" value={passRuns.length} tone={passRuns.length > 0 ? "success" : "default"} />
        <Metric label="Failed or blocked" value={failedRuns.length} tone={failedRuns.length > 0 ? "danger" : "default"} />
        <Metric label="Open findings" value={openFindings.length} tone={openFindings.length > 0 ? "warning" : "success"} />
      </div>

      {!hasHarnessData && items.length === 0 ? <HarnessEmptyState /> : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Experiments &amp; work</h2>
          <Pill>{items.length} total</Pill>
        </div>
        <div className="flex flex-wrap gap-2">
          <HarnessFilterChip label="All" count={items.length} active={bucketFilter === "all"} onClick={() => setBucketFilter("all")} />
          {HARNESS_BUCKETS.map((bucket) => (
            <HarnessFilterChip
              key={bucket}
              label={HARNESS_BUCKET_LABEL[bucket]}
              count={itemBucketCounts[bucket]}
              tone={HARNESS_BUCKET_TONE[bucket]}
              active={bucketFilter === bucket}
              onClick={() => setBucketFilter((current) => (current === bucket ? "all" : bucket))}
            />
          ))}
        </div>
        {items.length === 0 ? (
          <div className="border border-dashed border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
            No harness work items yet. Use Backfill to import harness issues.
          </div>
        ) : (
          <ItemsTable items={visibleItems} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Findings</h2>
          <Pill tone={openFindings.length > 0 ? "warning" : "success"}>{openFindings.length} open</Pill>
        </div>
        <FindingsTable findings={findings} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Runs</h2>
          <Pill>{runs.length} total</Pill>
        </div>
        <RunsTable runs={runs} />
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitPullRequest className="h-4 w-4" />
            <span>Linked issues</span>
          </div>
          <div className="mt-2 text-sm">{new Set([...runs.map((run) => run.issueId), ...findings.map((finding) => finding.issueId)].filter(Boolean)).size}</div>
        </div>
        <div className="border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-4 w-4" />
            <span>Latest run</span>
          </div>
          <div className="mt-2 text-sm">{runs[0]?.finishedAt ? formatDateTime(runs[0].finishedAt) : "none"}</div>
        </div>
        <div className="border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span>Next producer</span>
          </div>
          <div className="mt-2 text-sm">Harness Analyst / Terminal-Bench loop</div>
        </div>
      </div>
    </div>
  );
}
