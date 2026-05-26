import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  DatabaseZap,
  Eye,
  FlaskConical,
  GitMerge,
  GitPullRequest,
  PlayCircle,
  RadioTower,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type {
  Agent,
  AgentThroughput,
  AutoMergeCandidate,
  Feature,
  HarnessFinding,
  HarnessRun,
  Issue,
  RepoLock,
  VerificationRun,
} from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { deliveryControlApi } from "../api/deliveryControl";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
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
import { cn, formatDateTime, issueUrl, relativeTime } from "../lib/utils";

type PanelTone = "default" | "success" | "warning" | "danger";

function formatLabel(value: string | null | undefined): string {
  if (!value) return "none";
  return value.replace(/_/g, " ");
}

function isOpenIssue(issue: Issue): boolean {
  return issue.status !== "done" && issue.status !== "cancelled" && issue.hiddenAt == null;
}

function sortByUpdatedDesc(a: Issue, b: Issue): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function statusTone(status: string): PanelTone {
  if (status === "pass" || status === "free" || status === "merged_verified" || status === "live_verified") return "success";
  if (status === "fail" || status === "blocked_needs_benjamin" || status === "locked_cto") return "danger";
  if (status === "blocked" || status === "inconclusive" || status === "queued_repo_gate" || status === "in_review") return "warning";
  return "default";
}

function toneClasses(tone: PanelTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300";
    case "danger":
      return "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function MiniPill({ children, tone = "default" }: { children: ReactNode; tone?: PanelTone }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium", toneClasses(tone))}>
      {children}
    </span>
  );
}

function TowerMetric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: PanelTone;
}) {
  return (
    <div className="min-w-0 border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", tone === "danger" && "text-red-600 dark:text-red-300", tone === "warning" && "text-amber-600 dark:text-amber-300", tone === "success" && "text-emerald-600 dark:text-emerald-300")}>
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="min-w-0 border border-border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function agentName(agentsById: Map<string, Agent>, id: string | null | undefined): string {
  if (!id) return "unassigned";
  return agentsById.get(id)?.name ?? id.slice(0, 8);
}

function RepoLocksPanel({
  locks,
  agentsById,
  issuesById,
}: {
  locks: RepoLock[];
  agentsById: Map<string, Agent>;
  issuesById: Map<string, Issue>;
}) {
  const sortedLocks = [...locks].sort((a, b) => a.repo.localeCompare(b.repo));
  return (
    <Panel title="Repos / PRs" icon={GitPullRequest}>
      {sortedLocks.length === 0 ? (
        <EmptyPanel text="No repo locks" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Repo</th>
                <th className="px-2 py-2 font-medium">State</th>
                <th className="px-2 py-2 font-medium">Issue</th>
                <th className="px-2 py-2 font-medium">Branch / PR</th>
                <th className="px-2 py-2 font-medium">Owner</th>
                <th className="px-2 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {sortedLocks.map((lock) => {
                const issue = lock.activeIssueId ? issuesById.get(lock.activeIssueId) : null;
                return (
                  <tr key={lock.id} className="border-b border-border/70 last:border-0">
                    <td className="px-2 py-3 font-medium">{lock.repo}</td>
                    <td className="px-2 py-3"><MiniPill tone={statusTone(lock.state)}>{formatLabel(lock.state)}</MiniPill></td>
                    <td className="px-2 py-3">
                      {issue ? (
                        <Link to={issueUrl(issue)} className="font-mono text-xs text-primary hover:underline">
                          {issue.identifier ?? issue.id.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                    <td className="max-w-[240px] px-2 py-3">
                      <div className="truncate font-mono text-xs" title={lock.branch ?? undefined}>{lock.branch ?? "none"}</div>
                      {lock.prUrl ? (
                        <a href={lock.prUrl} className="text-xs text-primary hover:underline" target="_blank" rel="noreferrer">
                          PR
                        </a>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">{agentName(agentsById, lock.ownerAgentId)}</td>
                    <td className="max-w-[280px] px-2 py-3">
                      <div className="line-clamp-2 text-muted-foreground">{lock.nextAction ?? lock.blockerType ?? "none"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BenjaminRequiredPanel({ issues, agentsById }: { issues: Issue[]; agentsById: Map<string, Agent> }) {
  return (
    <Panel title="Benjamin Required" icon={ShieldAlert}>
      {issues.length === 0 ? (
        <EmptyPanel text="No Benjamin action" />
      ) : (
        <div className="space-y-3">
          {issues.slice(0, 8).map((issue) => (
            <div key={issue.id} className="border border-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={issueUrl(issue)} className="font-mono text-xs text-primary hover:underline">
                  {issue.identifier ?? issue.id.slice(0, 8)}
                </Link>
                <StatusBadge status={issue.status} />
                {issue.blockerType ? <MiniPill tone={statusTone(issue.blockerType)}>{formatLabel(issue.blockerType)}</MiniPill> : null}
              </div>
              <div className="mt-2 text-sm font-medium">{issue.title}</div>
              <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{issue.nextAction ?? "Decision required"}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {agentName(agentsById, issue.assigneeAgentId)} · {relativeTime(issue.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
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

function FeaturesPanel({
  features,
  issues,
  onBackfill,
  backfillPending,
  onMoveFeature,
  movePending,
  onOpenFeature,
}: {
  features: Feature[];
  issues: Issue[];
  onBackfill: () => void;
  backfillPending: boolean;
  onMoveFeature: (current: Feature, target: Feature, currentRank: number, targetRank: number) => void;
  movePending: boolean;
  onOpenFeature: (feature: Feature) => void;
}) {
  const issueFeatures = issues
    .filter((issue) => issue.category === "feature" && isOpenIssue(issue))
    .sort(sortByUpdatedDesc)
    .slice(0, 8);
  const visibleFeatures = features
    .slice()
    .sort((a, b) => (a.priorityRank ?? 9999) - (b.priorityRank ?? 9999) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);
  const moveFeature = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    const current = visibleFeatures[index];
    const target = visibleFeatures[targetIndex];
    if (!current || !target) return;
    onMoveFeature(current, target, current.priorityRank ?? index + 1, target.priorityRank ?? targetIndex + 1);
  };
  return (
    <Panel
      title="Features"
      icon={ClipboardCheck}
      action={
        <button
          type="button"
          onClick={onBackfill}
          disabled={backfillPending}
          className="inline-flex h-8 items-center gap-2 border border-border bg-background px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DatabaseZap className="h-4 w-4" />
          <span>{backfillPending ? "Backfill..." : "Backfill"}</span>
        </button>
      }
    >
      {visibleFeatures.length === 0 && issueFeatures.length === 0 ? (
        <EmptyPanel text="No active features" />
      ) : (
        <div className="space-y-2">
          {visibleFeatures.map((feature, index) => (
            <div key={feature.id} className="border border-border px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-primary">{feature.featureId}</span>
                  {feature.priorityRank !== null ? <MiniPill>#{feature.priorityRank}</MiniPill> : null}
                  <MiniPill tone={statusTone(feature.intakeStatus)}>{formatLabel(feature.intakeStatus)}</MiniPill>
                  <MiniPill tone={statusTone(feature.deliveryState)}>{formatLabel(feature.deliveryState)}</MiniPill>
                  <MiniPill>{formatLabel(feature.riskLevel)}</MiniPill>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    title="Open feature brief"
                    icon={Eye}
                    onClick={() => onOpenFeature(feature)}
                  />
                  <IconButton
                    title="Move feature up"
                    icon={ArrowUp}
                    disabled={index === 0 || movePending}
                    onClick={() => moveFeature(index, -1)}
                  />
                  <IconButton
                    title="Move feature down"
                    icon={ArrowDown}
                    disabled={index === visibleFeatures.length - 1 || movePending}
                    onClick={() => moveFeature(index, 1)}
                  />
                </div>
              </div>
              <div className="mt-2 line-clamp-1 text-sm font-medium">{feature.title}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{formatLabel(feature.productArea)}</span>
                {feature.repo ? <span>{feature.repo}</span> : null}
                {feature.impactEstimate ? <span>{feature.impactEstimate}</span> : null}
                {feature.effortEstimate ? <span>{feature.effortEstimate}</span> : null}
              </div>
              {feature.nextAction ? <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{feature.nextAction}</div> : null}
            </div>
          ))}
          {visibleFeatures.length === 0 ? issueFeatures.map((issue) => (
            <Link key={issue.id} to={issueUrl(issue)} className="block border border-border px-3 py-3 hover:bg-accent/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-primary">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                <MiniPill tone={statusTone(issue.deliveryState ?? issue.status)}>{formatLabel(issue.deliveryState ?? issue.status)}</MiniPill>
                {issue.surfaces?.slice(0, 2).map((surface) => <MiniPill key={surface}>{formatLabel(surface)}</MiniPill>)}
              </div>
              <div className="mt-2 line-clamp-1 text-sm font-medium">{issue.title}</div>
              {issue.nextAction ? <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{issue.nextAction}</div> : null}
            </Link>
          )) : null}
        </div>
      )}
    </Panel>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function renderBriefValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function FeatureDetailSheet({
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
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-border pr-10">
          <div className="flex flex-wrap items-center gap-2">
            {feature ? <span className="font-mono text-xs text-primary">{feature.featureId}</span> : null}
            {feature ? <MiniPill tone={statusTone(feature.intakeStatus)}>{formatLabel(feature.intakeStatus)}</MiniPill> : null}
            {feature ? <MiniPill tone={statusTone(feature.deliveryState)}>{formatLabel(feature.deliveryState)}</MiniPill> : null}
          </div>
          <SheetTitle>{feature?.title ?? "Feature"}</SheetTitle>
          <SheetDescription>
            {feature ? `${formatLabel(feature.productArea)}${feature.repo ? ` · ${feature.repo}` : ""}` : null}
          </SheetDescription>
        </SheetHeader>
        {feature ? (
          <div className="space-y-3 p-4">
            <FieldRow label="Why now" value={feature.whyNow ?? "none"} />
            <FieldRow label="Impact" value={feature.impactEstimate ?? "none"} />
            <FieldRow label="Effort" value={feature.effortEstimate ?? "none"} />
            <FieldRow label="Risk" value={formatLabel(feature.riskLevel)} />
            <FieldRow label="Next action" value={feature.nextAction ?? "none"} />
            <FieldRow
              label="Required evidence"
              value={feature.requiredEvidence.length > 0 ? feature.requiredEvidence.join(", ") : "none"}
            />
            {feature.rootIssueId ? (
              <FieldRow
                label="Root issue"
                value={<Link to={`/issues/${feature.rootIssueId}`} className="text-primary hover:underline">{feature.rootIssueId.slice(0, 8)}</Link>}
              />
            ) : null}
            {briefEntries.length > 0 ? (
              <div className="space-y-2">
                {briefEntries.map(([key, value]) => (
                  <FieldRow key={key} label={formatLabel(key)} value={renderBriefValue(value)} />
                ))}
              </div>
            ) : null}
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

function EvidencePanel({ runs }: { runs: VerificationRun[] }) {
  const recentRuns = runs.slice(0, 8);
  return (
    <Panel title="Evidence" icon={CheckCircle2}>
      {recentRuns.length === 0 ? (
        <EmptyPanel text="No verification runs" />
      ) : (
        <div className="space-y-2">
          {recentRuns.map((run) => (
            <div key={run.id} className="border border-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <MiniPill tone={statusTone(run.status)}>{run.status}</MiniPill>
                <span className="text-xs text-muted-foreground">{formatLabel(run.type)}</span>
                {run.repo ? <span className="text-xs text-muted-foreground">{run.repo}</span> : null}
              </div>
              <div className="mt-2 line-clamp-2 text-sm">{run.verdictSummary ?? run.command ?? "Verification run"}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {run.finishedAt ? formatDateTime(run.finishedAt) : "unfinished"}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function HarnessPanel({ runs, findings }: { runs: HarnessRun[]; findings: HarnessFinding[] }) {
  const openFindings = findings.filter((finding) => !["resolved", "waived"].includes(finding.status));
  return (
    <Panel title="Harness" icon={FlaskConical} action={<MiniPill tone={openFindings.length > 0 ? "warning" : "success"}>{openFindings.length} open</MiniPill>}>
      {runs.length === 0 && findings.length === 0 ? (
        <EmptyPanel text="No harness data" />
      ) : (
        <div className="space-y-3">
          {openFindings.slice(0, 5).map((finding) => (
            <div key={finding.id} className="border border-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <MiniPill tone={finding.severity === "critical" || finding.severity === "high" ? "danger" : "warning"}>{finding.severity}</MiniPill>
                <MiniPill>{formatLabel(finding.status)}</MiniPill>
              </div>
              <div className="mt-2 text-sm font-medium">{finding.title}</div>
              {finding.nextAction ? <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{finding.nextAction}</div> : null}
            </div>
          ))}
          {runs.slice(0, 3).map((run) => (
            <div key={run.id} className="border border-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <MiniPill tone={statusTone(run.status)}>{run.status}</MiniPill>
                {run.benchmarkName ? <span className="text-xs text-muted-foreground">{run.benchmarkName}</span> : null}
              </div>
              <div className="mt-2 line-clamp-1 text-sm">{run.verdictSummary ?? run.experimentId ?? "Harness run"}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AgentThroughputPanel({ rows }: { rows: AgentThroughput[] }) {
  const activeRows = rows
    .filter((row) =>
      row.assignedOpenIssues > 0 ||
      row.runs24h > 0 ||
      row.activityEvents24h > 0 ||
      row.status !== "idle",
    )
    .slice(0, 8);
  return (
    <Panel title="Agents & Throughput" icon={Activity}>
      {activeRows.length === 0 ? (
        <EmptyPanel text="No active agent throughput" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Agent</th>
                <th className="px-2 py-2 font-medium">Open</th>
                <th className="px-2 py-2 font-medium">Runs 24h</th>
                <th className="px-2 py-2 font-medium">Signal</th>
                <th className="px-2 py-2 font-medium">7d flow</th>
                <th className="px-2 py-2 font-medium">Last run</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const pressure = row.assignedBlockedIssues + row.blockedRuns24h;
                const tone: PanelTone = pressure > 0 ? "danger" : row.planOnlyRuns24h > row.productiveRuns24h ? "warning" : "success";
                return (
                  <tr key={row.agentId} className="border-b border-border/70 last:border-0">
                    <td className="max-w-[220px] px-2 py-3">
                      <div className="truncate font-medium">{row.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{formatLabel(row.role)} · {formatLabel(row.status)}</div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        <MiniPill>{row.assignedOpenIssues}</MiniPill>
                        {row.assignedBlockedIssues > 0 ? <MiniPill tone="danger">{row.assignedBlockedIssues} blocked</MiniPill> : null}
                        {row.assignedInReviewIssues > 0 ? <MiniPill tone="warning">{row.assignedInReviewIssues} review</MiniPill> : null}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        <MiniPill>{row.runs24h}</MiniPill>
                        {row.failedRuns24h > 0 ? <MiniPill tone="danger">{row.failedRuns24h} failed</MiniPill> : null}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        <MiniPill tone={tone}>{row.productiveRuns24h} useful</MiniPill>
                        {row.planOnlyRuns24h > 0 ? <MiniPill tone="warning">{row.planOnlyRuns24h} plan-only</MiniPill> : null}
                        {row.blockedRuns24h > 0 ? <MiniPill tone="danger">{row.blockedRuns24h} blocked</MiniPill> : null}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {row.createdIssues7d} created · {row.completedIssues7d} done
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {row.lastRunAt ? relativeTime(row.lastRunAt) : row.lastHeartbeatAt ? relativeTime(row.lastHeartbeatAt) : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AutoMergePanel({ candidates }: { candidates: AutoMergeCandidate[] }) {
  const visibleCandidates = candidates.slice(0, 8);
  return (
    <Panel title="Auto-Merge Candidates" icon={GitMerge}>
      {visibleCandidates.length === 0 ? (
        <EmptyPanel text="No auto-merge candidates" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Issue</th>
                <th className="px-2 py-2 font-medium">Repo</th>
                <th className="px-2 py-2 font-medium">PR</th>
                <th className="px-2 py-2 font-medium">Evidence</th>
                <th className="px-2 py-2 font-medium">Verdict</th>
                <th className="px-2 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((candidate) => (
                <tr key={candidate.issueId} className="border-b border-border/70 last:border-0">
                  <td className="max-w-[260px] px-2 py-3">
                    <Link to={issueUrl({ id: candidate.issueId, identifier: candidate.identifier })} className="font-mono text-xs text-primary hover:underline">
                      {candidate.identifier ?? candidate.issueId.slice(0, 8)}
                    </Link>
                    <div className="mt-1 truncate font-medium">{candidate.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge status={candidate.status} />
                      <MiniPill tone={statusTone(candidate.deliveryState)}>{formatLabel(candidate.deliveryState)}</MiniPill>
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="font-medium">{candidate.repo ?? "unknown"}</div>
                    {candidate.repoLockState ? (
                      <div className="mt-1"><MiniPill tone={statusTone(candidate.repoLockState)}>{formatLabel(candidate.repoLockState)}</MiniPill></div>
                    ) : null}
                  </td>
                  <td className="max-w-[180px] px-2 py-3">
                    <div className="truncate font-mono text-xs" title={candidate.branch ?? undefined}>{candidate.branch ?? "none"}</div>
                    {candidate.prUrl ? (
                      <a href={candidate.prUrl} className="text-xs text-primary hover:underline" target="_blank" rel="noreferrer">
                        PR
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">missing</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1">
                      <MiniPill tone={candidate.passedVerificationCount > 0 ? "success" : "warning"}>{candidate.passedVerificationCount} pass</MiniPill>
                      {candidate.failedVerificationCount > 0 ? <MiniPill tone="danger">{candidate.failedVerificationCount} blocked</MiniPill> : null}
                      {candidate.securityStatus ? <MiniPill tone={candidate.securityStatus === "pass" || candidate.securityStatus === "not_recorded" ? "success" : "danger"}>sec {formatLabel(candidate.securityStatus)}</MiniPill> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {candidate.latestVerificationAt ? relativeTime(candidate.latestVerificationAt) : "no run"}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <MiniPill tone={candidate.eligible ? "success" : "warning"}>
                      {candidate.eligible ? "eligible" : `${candidate.reasons.length} gate${candidate.reasons.length > 1 ? "s" : ""}`}
                    </MiniPill>
                    {candidate.storedAutoMergeEligible && !candidate.eligible ? (
                      <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">flag mismatch</div>
                    ) : null}
                  </td>
                  <td className="max-w-[280px] px-2 py-3">
                    <div className="line-clamp-2 text-muted-foreground">{candidate.nextAction ?? candidate.reasons.join(", ")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ControlTower() {
  const { selectedCompanyId, companies } = useCompany();
  const queryClient = useQueryClient();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Control Tower" }]);
  }, [setBreadcrumbs]);

  const repoLocksQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.repoLocks(selectedCompanyId) : ["delivery-control", "repo-locks", "__disabled__"],
    queryFn: () => deliveryControlApi.listRepoLocks(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const agentThroughputQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.agentThroughput(selectedCompanyId) : ["delivery-control", "agent-throughput", "__disabled__"],
    queryFn: () => deliveryControlApi.listAgentThroughput(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const featuresQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.features(selectedCompanyId) : ["delivery-control", "features", "__disabled__"],
    queryFn: () => deliveryControlApi.listFeatures(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const autoMergeCandidatesQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.autoMergeCandidates(selectedCompanyId) : ["delivery-control", "auto-merge-candidates", "__disabled__"],
    queryFn: () => deliveryControlApi.listAutoMergeCandidates(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const verificationRunsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.verificationRuns(selectedCompanyId) : ["delivery-control", "verification-runs", "__disabled__"],
    queryFn: () => deliveryControlApi.listVerificationRuns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const harnessRunsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.harnessRuns(selectedCompanyId) : ["delivery-control", "harness-runs", "__disabled__"],
    queryFn: () => deliveryControlApi.listHarnessRuns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const harnessFindingsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.harnessFindings(selectedCompanyId) : ["delivery-control", "harness-findings", "__disabled__"],
    queryFn: () => deliveryControlApi.listHarnessFindings(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const issuesQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.issues.list(selectedCompanyId) : ["issues", "__control_tower_disabled__"],
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "__control_tower_disabled__"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const backfillFeaturesMutation = useMutation({
    mutationFn: () => deliveryControlApi.backfillFeaturesFromIssues(selectedCompanyId!),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.features(selectedCompanyId) });
      }
    },
  });
  const moveFeatureMutation = useMutation({
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
  const selectFeatureMutation = useMutation({
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

  const isLoading =
    repoLocksQuery.isLoading ||
    agentThroughputQuery.isLoading ||
    featuresQuery.isLoading ||
    autoMergeCandidatesQuery.isLoading ||
    verificationRunsQuery.isLoading ||
    harnessRunsQuery.isLoading ||
    harnessFindingsQuery.isLoading ||
    issuesQuery.isLoading ||
    agentsQuery.isLoading;

  const error =
    repoLocksQuery.error ||
    agentThroughputQuery.error ||
    featuresQuery.error ||
    autoMergeCandidatesQuery.error ||
    verificationRunsQuery.error ||
    harnessRunsQuery.error ||
    harnessFindingsQuery.error ||
    issuesQuery.error ||
    agentsQuery.error;

  const repoLocks = repoLocksQuery.data ?? [];
  const agentThroughput = agentThroughputQuery.data ?? [];
  const features = featuresQuery.data ?? [];
  const autoMergeCandidates = autoMergeCandidatesQuery.data ?? [];
  const verificationRuns = verificationRunsQuery.data ?? [];
  const harnessRuns = harnessRunsQuery.data ?? [];
  const harnessFindings = harnessFindingsQuery.data ?? [];
  const issues = issuesQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const issuesById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);
  const benjaminIssues = useMemo(
    () => issues.filter((issue) => issue.benjaminRequired && isOpenIssue(issue)).sort(sortByUpdatedDesc),
    [issues],
  );
  const activeIssues = issues.filter(isOpenIssue);
  const lockedRepos = repoLocks.filter((lock) => lock.state !== "free").length;
  const failedEvidence = verificationRuns.filter((run) => run.status === "fail" || run.status === "blocked").length;
  const eligibleAutoMergeCandidates = autoMergeCandidates.filter((candidate) => candidate.eligible).length;
  const selectedFeature = selectedFeatureId ? features.find((feature) => feature.id === selectedFeatureId) ?? null : null;

  if (!selectedCompanyId) {
    return companies.length === 0
      ? <EmptyState icon={RadioTower} message="Create a company to open Control Tower." />
      : <EmptyState icon={RadioTower} message="Select a company to open Control Tower." />;
  }

  if (isLoading) return <PageSkeleton variant="dashboard" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Control Tower</h1>
          <p className="mt-1 text-sm text-muted-foreground">Delivery gates, evidence, and attention routing.</p>
        </div>
        {error ? (
          <div className="flex items-center gap-2 border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Control Tower data failed to load.</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TowerMetric label="Benjamin Required" value={benjaminIssues.length} icon={ShieldAlert} tone={benjaminIssues.length > 0 ? "danger" : "success"} />
        <TowerMetric label="Locked Repos" value={lockedRepos} icon={GitPullRequest} tone={lockedRepos > 0 ? "warning" : "success"} />
        <TowerMetric label="Failed Evidence" value={failedEvidence} icon={CircleDot} tone={failedEvidence > 0 ? "danger" : "success"} />
        <TowerMetric label="Auto-Merge Ready" value={eligibleAutoMergeCandidates} icon={GitMerge} tone={eligibleAutoMergeCandidates > 0 ? "warning" : "success"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <RepoLocksPanel locks={repoLocks} agentsById={agentsById} issuesById={issuesById} />
        <BenjaminRequiredPanel issues={benjaminIssues} agentsById={agentsById} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <FeaturesPanel
          features={features}
          issues={activeIssues}
          onBackfill={() => backfillFeaturesMutation.mutate()}
          backfillPending={backfillFeaturesMutation.isPending}
          onMoveFeature={(current, target, currentRank, targetRank) =>
            moveFeatureMutation.mutate({ current, target, currentRank, targetRank })
          }
          movePending={moveFeatureMutation.isPending}
          onOpenFeature={(feature) => setSelectedFeatureId(feature.id)}
        />
        <EvidencePanel runs={verificationRuns} />
        <HarnessPanel runs={harnessRuns} findings={harnessFindings} />
      </div>

      <AutoMergePanel candidates={autoMergeCandidates} />

      <AgentThroughputPanel rows={agentThroughput} />
      <FeatureDetailSheet
        feature={selectedFeature}
        open={selectedFeature !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedFeatureId(null);
        }}
        onSelectForDelivery={(feature) => selectFeatureMutation.mutate(feature)}
        selectPending={selectFeatureMutation.isPending}
      />
    </div>
  );
}
