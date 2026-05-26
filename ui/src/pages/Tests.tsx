import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, DatabaseZap, Eye, FlaskConical } from "lucide-react";
import type { TestCase } from "@paperclipai/shared";
import { deliveryControlApi } from "../api/deliveryControl";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDateTime } from "../lib/utils";

type Tone = "default" | "success" | "warning" | "danger";

const NON_TERMINAL_STATUSES = new Set(["missing", "stale", "flaky", "blocked", "skipped", "inconclusive"]);

function formatLabel(value: string | null | undefined): string {
  if (!value) return "none";
  return value.replace(/_/g, " ");
}

function toneFor(value: string | null | undefined): Tone {
  if (!value) return "default";
  if (value === "pass" || value === "active") return "success";
  if (value === "fail" || value === "blocked") return "danger";
  if (NON_TERMINAL_STATUSES.has(value) || value === "missing" || value === "designed") return "warning";
  return "default";
}

function toneClasses(tone: Tone): string {
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

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium", toneClasses(tone))}>
      {children}
    </span>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: Tone }) {
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

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b));
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</div>
    </div>
  );
}

function TestDrawer({
  testCase,
  open,
  onOpenChange,
}: {
  testCase: TestCase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-border pr-10">
          <div className="flex flex-wrap items-center gap-2">
            {testCase ? <span className="font-mono text-xs text-primary">{testCase.stableKey}</span> : null}
            {testCase ? <Pill tone={toneFor(testCase.lastStatus ?? testCase.status)}>{formatLabel(testCase.lastStatus ?? testCase.status)}</Pill> : null}
            {testCase?.requiredForDelivery ? <Pill tone="warning">required</Pill> : null}
          </div>
          <SheetTitle>{testCase?.title ?? "Test"}</SheetTitle>
          <SheetDescription>
            {testCase ? `${formatLabel(testCase.repo)} · ${formatLabel(testCase.type)} · ${formatLabel(testCase.trigger)}` : null}
          </SheetDescription>
        </SheetHeader>
        {testCase ? (
          <div className="space-y-3 p-4">
            <Field label="Command" value={testCase.command ?? "none"} />
            <Field label="Owner" value={testCase.owner ?? "unassigned"} />
            <Field label="Source" value={`${formatLabel(testCase.source)}${testCase.sourcePath ? `\n${testCase.sourcePath}` : ""}`} />
            <Field label="Risk covered" value={testCase.riskCovered ?? "none"} />
            <Field label="Last run" value={testCase.lastRunAt ? formatDateTime(testCase.lastRunAt) : "unknown"} />
            <Field label="Artifacts" value={testCase.artifactRefs.length > 0 ? testCase.artifactRefs.join("\n") : "none"} />
            <Field label="Linked feature / issue" value={[...testCase.featureIds, ...testCase.issueIds].length > 0 ? [...testCase.featureIds, ...testCase.issueIds].join(", ") : "none"} />
            <Field label="Next action" value={testCase.nextAction ?? "none"} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function Tests() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Work", href: "/issues" }, { label: "Tests" }]);
  }, [setBreadcrumbs]);

  const testsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.deliveryControl.testCases(selectedCompanyId) : ["delivery-control", "test-cases", "__disabled__"],
    queryFn: () => deliveryControlApi.listTestCases(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const backfillMutation = useMutation({
    mutationFn: () => deliveryControlApi.backfillSouverTestCases(selectedCompanyId!),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryControl.testCases(selectedCompanyId) });
      }
    },
  });

  const tests = testsQuery.data ?? [];
  const filteredTests = useMemo(() => tests.filter((testCase) => {
    const lastOrCaseStatus = testCase.lastStatus ?? testCase.status;
    if (repoFilter !== "all" && testCase.repo !== repoFilter) return false;
    if (typeFilter !== "all" && testCase.type !== typeFilter) return false;
    if (statusFilter !== "all" && lastOrCaseStatus !== statusFilter && testCase.status !== statusFilter) return false;
    if (ownerFilter !== "all" && (testCase.owner ?? "unassigned") !== ownerFilter) return false;
    if (deliveryFilter === "required" && !testCase.requiredForDelivery) return false;
    if (deliveryFilter === "current" && (!testCase.requiredForDelivery || NON_TERMINAL_STATUSES.has(lastOrCaseStatus))) return false;
    return true;
  }), [deliveryFilter, ownerFilter, repoFilter, statusFilter, tests, typeFilter]);
  const selectedTest = selectedKey ? tests.find((testCase) => testCase.stableKey === selectedKey) ?? null : null;

  const repoOptions = uniqueSorted(tests.map((testCase) => testCase.repo));
  const typeOptions = uniqueSorted(tests.map((testCase) => testCase.type));
  const statusOptions = uniqueSorted(tests.flatMap((testCase) => [testCase.status, testCase.lastStatus]));
  const ownerOptions = uniqueSorted(tests.map((testCase) => testCase.owner));
  const passCount = tests.filter((testCase) => testCase.lastStatus === "pass").length;
  const gapCount = tests.filter((testCase) => NON_TERMINAL_STATUSES.has(testCase.lastStatus ?? testCase.status)).length;
  const securityCount = tests.filter((testCase) => testCase.type === "security").length;

  if (!selectedCompanyId) {
    return companies.length === 0
      ? <EmptyState icon={FlaskConical} message="Create a company to open Tests." />
      : <EmptyState icon={FlaskConical} message="Select a company to open Tests." />;
  }

  if (testsQuery.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Tests</h1>
          <p className="mt-1 text-sm text-muted-foreground">Read-only test library, evidence status, and delivery gaps.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending}>
          <DatabaseZap className="h-4 w-4" />
          {backfillMutation.isPending ? "Backfilling..." : "Backfill"}
        </Button>
      </div>

      {testsQuery.error ? (
        <div className="flex items-center gap-2 border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Tests failed to load.</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Imported" value={tests.length} />
        <Metric label="Passing evidence" value={passCount} tone={passCount > 0 ? "success" : "default"} />
        <Metric label="Visible gaps" value={gapCount} tone={gapCount > 0 ? "warning" : "default"} />
        <Metric label="Security" value={securityCount} />
      </div>

      <div className="grid gap-2 border border-border bg-card p-3 md:grid-cols-5">
        <FilterSelect label="Repo" value={repoFilter} onChange={setRepoFilter} options={repoOptions} />
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
        <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} />
        <FilterSelect label="Delivery" value={deliveryFilter} onChange={setDeliveryFilter} options={["required", "current"]} />
      </div>

      {filteredTests.length === 0 ? (
        <div className="border border-dashed border-border bg-card">
          <EmptyState icon={FlaskConical} message="No tests match the current filters." />
        </div>
      ) : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full min-w-[1240px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Test</th>
                <th className="px-3 py-3 font-medium">Repo</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Last status</th>
                <th className="px-3 py-3 font-medium">Last run</th>
                <th className="px-3 py-3 font-medium">Owner</th>
                <th className="px-3 py-3 font-medium">Command</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="w-16 px-3 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredTests.map((testCase) => (
                <tr key={testCase.id} className="border-b border-border/70 last:border-0">
                  <td className="max-w-[280px] px-3 py-3 align-top">
                    <div className="font-mono text-xs text-primary">{testCase.stableKey}</div>
                    <button type="button" className="mt-1 line-clamp-2 text-left font-medium hover:text-primary" onClick={() => setSelectedKey(testCase.stableKey)}>
                      {testCase.title}
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">{testCase.requiredForDelivery ? "required" : "optional"} · {formatLabel(testCase.trigger)}</div>
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">{formatLabel(testCase.repo)}</td>
                  <td className="px-3 py-3 align-top"><Pill>{formatLabel(testCase.type)}</Pill></td>
                  <td className="px-3 py-3 align-top"><Pill tone={toneFor(testCase.lastStatus ?? testCase.status)}>{formatLabel(testCase.lastStatus ?? testCase.status)}</Pill></td>
                  <td className="px-3 py-3 align-top text-muted-foreground">{testCase.lastRunAt ? formatDateTime(testCase.lastRunAt) : "unknown"}</td>
                  <td className="max-w-[220px] px-3 py-3 align-top"><div className="line-clamp-2 text-muted-foreground">{testCase.owner ?? "unassigned"}</div></td>
                  <td className="max-w-[260px] px-3 py-3 align-top"><div className="line-clamp-2 font-mono text-xs text-muted-foreground">{testCase.command ?? "none"}</div></td>
                  <td className="px-3 py-3 align-top text-muted-foreground">{formatLabel(testCase.source)}</td>
                  <td className="px-3 py-3 align-top text-right">
                    <button type="button" title="Open test detail" aria-label="Open test detail" className="inline-flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground" onClick={() => setSelectedKey(testCase.stableKey)}>
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TestDrawer testCase={selectedTest} open={selectedTest !== null} onOpenChange={(open) => !open && setSelectedKey(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="min-w-0 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full border border-border bg-background px-2 text-sm text-foreground"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}
