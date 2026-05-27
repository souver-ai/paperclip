import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  DatabaseZap,
  Eye,
  Link as LinkIcon,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";
import { featureBucket, FEATURE_BUCKETS, type Feature, type FeatureBucket } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { deliveryControlApi } from "../api/deliveryControl";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
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
  if (["delivered", "merged", "target_verifying", "merged_verified", "live_verified"].includes(value)) return "success";
  if (["blocked", "locked_cto", "blocked_needs_benjamin", "rejected", "changes_requested"].includes(value)) return "danger";
  if (["selected", "in_delivery", "active_branch", "pr_ready", "in_review", "merge_ready"].includes(value)) return "info";
  if (["queued", "ready_for_priority", "queued_repo_gate", "pm_framing", "proposed"].includes(value)) return "warning";
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

// Coarse delivery buckets shown in the table + filter bar. Each bucket has a distinct tone so
// "in delivery" (blue) is never confused with "queued" (amber), and done-but-unmerged stands out.
const BUCKET_TONE: Record<FeatureBucket, Tone> = {
  delivered: "success",
  delivered_unmerged: "caution",
  done_noncode: "default",
  in_delivery: "info",
  queued: "warning",
  parked: "default",
  abandoned: "danger",
};

const BUCKET_LABEL: Record<FeatureBucket, string> = {
  delivered: "Delivered",
  delivered_unmerged: "Done · unmerged",
  done_noncode: "Done (non-code)",
  in_delivery: "In delivery",
  queued: "Queued",
  parked: "Parked",
  abandoned: "Abandoned",
};

function bucketOf(feature: Feature): FeatureBucket {
  return featureBucket(feature.intakeStatus, feature.deliveryState, feature.title);
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium", toneClasses(tone))}>
      {children}
    </span>
  );
}

function FilterChip({
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

function IconButton({
  title,
  icon: Icon,
  disabled,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function sortFeatures(features: Feature[]): Feature[] {
  return features
    .slice()
    .sort((a, b) => (a.priorityRank ?? 9999) - (b.priorityRank ?? 9999) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function terminalEvidenceText(feature: Feature): string {
  if (!feature.terminalEvidence) return "none";
  const entries = Object.entries(feature.terminalEvidence);
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${formatLabel(key)}: ${renderValue(value)}`).join("; ");
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function FeatureDrawer({
  feature,
  open,
  onOpenChange,
  onSelectForDelivery,
  selectPending,
}: {
  feature: Feature | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectForDelivery: (feature: Feature) => void;
  selectPending: boolean;
}) {
  const briefEntries = feature ? Object.entries(feature.pmBrief ?? {}) : [];
  const canSelect = feature
    ? !["selected", "in_delivery", "delivered", "rejected", "parked"].includes(feature.intakeStatus)
    : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-border pr-10">
          <div className="flex flex-wrap items-center gap-2">
            {feature ? <span className="font-mono text-xs text-primary">{feature.featureId}</span> : null}
            {feature ? <Pill tone={BUCKET_TONE[bucketOf(feature)]}>{BUCKET_LABEL[bucketOf(feature)]}</Pill> : null}
            {feature ? <Pill tone={toneFor(feature.deliveryState)}>{formatLabel(feature.deliveryState)}</Pill> : null}
          </div>
          <SheetTitle>{feature?.title ?? "Feature"}</SheetTitle>
          <SheetDescription>
            {feature ? `${formatLabel(feature.productArea)}${feature.repo ? ` · ${feature.repo}` : ""}` : null}
          </SheetDescription>
        </SheetHeader>
        {feature ? (
          <div className="space-y-3 p-4">
            <Field label="PM brief" value={briefEntries.length > 0 ? briefEntries.map(([key, value]) => `${formatLabel(key)}: ${renderValue(value)}`).join("\n") : "none"} />
            <Field label="Expected evidence" value={feature.requiredEvidence.length > 0 ? feature.requiredEvidence.join(", ") : "none"} />
            <Field label="Terminal evidence" value={terminalEvidenceText(feature)} />
            <Field label="Root issue" value={feature.rootIssueId ? <Link to={`/issues/${feature.rootIssueId}`} className="inline-flex items-center gap-1 text-primary hover:underline"><LinkIcon className="h-3.5 w-3.5" />{feature.rootIssueId.slice(0, 8)}</Link> : "none"} />
            <Field label="Repo" value={feature.repo ?? "none"} />
            <Field label="Delivery state" value={formatLabel(feature.deliveryState)} />
            <Field label="Next action" value={feature.nextAction ?? "none"} />
            <Field label="Why now" value={feature.whyNow ?? "none"} />
            <Field label="Impact" value={feature.impactEstimate ?? "none"} />
            <Field label="Effort" value={feature.effortEstimate ?? "none"} />
            <Field label="Risk" value={formatLabel(feature.riskLevel)} />
          </div>
        ) : null}
        <SheetFooter className="border-t border-border">
          <Button
            type="button"
            disabled={!feature || !canSelect || selectPending}
            onClick={() => feature && onSelectForDelivery(feature)}
          >
            <PlayCircle className="h-4 w-4" />
            {selectPending ? "Selecting..." : "Select for delivery"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm">{value}</div>
    </div>
  );
}

export function Features() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<FeatureBucket | "all">("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Work", href: "/issues" }, { label: "Features" }]);
  }, [setBreadcrumbs]);

  const featuresQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.features(selectedCompanyId) : ["delivery-control", "features", "__disabled__"],
    queryFn: () => deliveryControlApi.listFeatures(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const backfillMutation = useMutation({
    mutationFn: () => deliveryControlApi.backfillFeaturesFromIssues(selectedCompanyId!),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.features(selectedCompanyId) });
      }
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({
      current,
      target,
      currentRank,
      targetRank,
    }: {
      current: Feature;
      target: Feature;
      currentRank: number;
      targetRank: number;
    }) => {
      await Promise.all([
        deliveryControlApi.updateFeature(current.id, { priorityRank: targetRank }),
        deliveryControlApi.updateFeature(target.id, { priorityRank: currentRank }),
      ]);
    },
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.features(selectedCompanyId) });
      }
    },
  });

  const selectMutation = useMutation({
    mutationFn: (feature: Feature) =>
      deliveryControlApi.updateFeature(feature.id, {
        intakeStatus: "selected",
        nextAction: "CTO selected this feature for delivery; wait for repo gate before branch start.",
      }),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.features(selectedCompanyId) });
      }
    },
  });

  const sortedFeatures = useMemo(() => sortFeatures(featuresQuery.data ?? []), [featuresQuery.data]);
  const bucketCounts = useMemo(() => {
    const counts = Object.fromEntries(FEATURE_BUCKETS.map((bucket) => [bucket, 0])) as Record<FeatureBucket, number>;
    for (const feature of sortedFeatures) counts[bucketOf(feature)] += 1;
    return counts;
  }, [sortedFeatures]);
  const visibleFeatures = useMemo(
    () => (bucketFilter === "all" ? sortedFeatures : sortedFeatures.filter((feature) => bucketOf(feature) === bucketFilter)),
    [sortedFeatures, bucketFilter],
  );
  const selectedFeature = selectedFeatureId ? sortedFeatures.find((feature) => feature.id === selectedFeatureId) ?? null : null;
  const reorderEnabled = bucketFilter === "all";

  if (!selectedCompanyId) {
    return companies.length === 0
      ? <EmptyState icon={ClipboardCheck} message="Create a company to open Features." />
      : <EmptyState icon={ClipboardCheck} message="Select a company to open Features." />;
  }

  if (featuresQuery.isLoading) return <PageSkeleton variant="list" />;

  const moveFeature = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    const current = sortedFeatures[index];
    const target = sortedFeatures[targetIndex];
    if (!current || !target) return;
    moveMutation.mutate({
      current,
      target,
      currentRank: current.priorityRank ?? index + 1,
      targetRank: target.priorityRank ?? targetIndex + 1,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Features</h1>
          <p className="mt-1 text-sm text-muted-foreground">Delivery status, rank, evidence, and next action for native feature records.</p>
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
      </div>

      {featuresQuery.error ? (
        <div className="flex items-center gap-2 border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Features failed to load.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All"
          count={sortedFeatures.length}
          active={bucketFilter === "all"}
          onClick={() => setBucketFilter("all")}
        />
        {FEATURE_BUCKETS.map((bucket) => (
          <FilterChip
            key={bucket}
            label={BUCKET_LABEL[bucket]}
            count={bucketCounts[bucket]}
            tone={BUCKET_TONE[bucket]}
            active={bucketFilter === bucket}
            onClick={() => setBucketFilter((current) => (current === bucket ? "all" : bucket))}
          />
        ))}
      </div>

      {sortedFeatures.length === 0 ? (
        <div className="border border-dashed border-border bg-card">
          <EmptyState
            icon={ClipboardCheck}
            message="No native features yet."
            action="Backfill from issues"
            onAction={() => backfillMutation.mutate()}
          />
        </div>
      ) : visibleFeatures.length === 0 ? (
        <div className="border border-dashed border-border bg-card">
          <EmptyState icon={ClipboardCheck} message={`No features in "${BUCKET_LABEL[bucketFilter as FeatureBucket]}".`} />
        </div>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="w-20 px-3 py-3 font-medium">Rank</th>
                <th className="px-3 py-3 font-medium">Feature</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Progress</th>
                <th className="px-3 py-3 font-medium">Repo</th>
                <th className="px-3 py-3 font-medium">Evidence</th>
                <th className="px-3 py-3 font-medium">Next action</th>
                <th className="w-28 px-3 py-3 text-right font-medium">Controls</th>
              </tr>
            </thead>
            <tbody>
              {visibleFeatures.map((feature, index) => (
                <tr key={feature.id} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-3 align-top font-mono text-xs text-muted-foreground">
                    {feature.priorityRank !== null ? `#${feature.priorityRank}` : "none"}
                  </td>
                  <td className="max-w-[280px] px-3 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-primary">{feature.featureId}</span>
                      <Pill tone={toneFor(feature.riskLevel)}>{formatLabel(feature.riskLevel)}</Pill>
                    </div>
                    <button
                      type="button"
                      className="mt-2 line-clamp-2 text-left font-medium hover:text-primary"
                      onClick={() => setSelectedFeatureId(feature.id)}
                    >
                      {feature.title}
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatLabel(feature.productArea)} · updated {formatDateTime(feature.updatedAt)}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <Pill tone={BUCKET_TONE[bucketOf(feature)]}>{BUCKET_LABEL[bucketOf(feature)]}</Pill>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <Pill tone={toneFor(feature.deliveryState)}>{formatLabel(feature.deliveryState)}</Pill>
                  </td>
                  <td className="max-w-[160px] px-3 py-3 align-top">
                    <div className="truncate text-muted-foreground" title={feature.repo ?? undefined}>{feature.repo ?? "none"}</div>
                    {feature.rootIssueId ? (
                      <Link to={`/issues/${feature.rootIssueId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <LinkIcon className="h-3 w-3" />
                        root issue
                      </Link>
                    ) : null}
                  </td>
                  <td className="max-w-[220px] px-3 py-3 align-top">
                    <div className="line-clamp-2 text-muted-foreground">
                      {feature.requiredEvidence.length > 0 ? feature.requiredEvidence.join(", ") : "none"}
                    </div>
                  </td>
                  <td className="max-w-[300px] px-3 py-3 align-top">
                    <div className="line-clamp-3 text-muted-foreground">{feature.nextAction ?? "none"}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Open feature detail" icon={Eye} onClick={() => setSelectedFeatureId(feature.id)} />
                      <IconButton title={reorderEnabled ? "Move feature up" : "Clear filter to reorder"} icon={ArrowUp} disabled={!reorderEnabled || index === 0 || moveMutation.isPending} onClick={() => moveFeature(index, -1)} />
                      <IconButton title={reorderEnabled ? "Move feature down" : "Clear filter to reorder"} icon={ArrowDown} disabled={!reorderEnabled || index === visibleFeatures.length - 1 || moveMutation.isPending} onClick={() => moveFeature(index, 1)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FeatureDrawer
        feature={selectedFeature}
        open={selectedFeature !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedFeatureId(null);
        }}
        onSelectForDelivery={(feature) => selectMutation.mutate(feature)}
        selectPending={selectMutation.isPending}
      />
    </div>
  );
}
