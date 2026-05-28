import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw } from "lucide-react";
import { quotaGovernorApi } from "../api/quotaGovernor";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { QuotaGovernorPanel } from "../components/QuotaGovernorPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

export function QuotaGovernor() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Quota Governor" }]);
  }, [setBreadcrumbs]);

  const queryKey = selectedCompanyId ? queryKeys.quotaGovernor(selectedCompanyId) : ["quota-governor"];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => quotaGovernorApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });
  const snapshotMutation = useMutation({
    mutationFn: () => quotaGovernorApi.snapshot(selectedCompanyId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (isLoading) return <PageSkeleton variant="dashboard" />;

  const snapshot = data?.snapshot ?? null;
  if (!snapshot) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
            disabled={!selectedCompanyId || snapshotMutation.isPending}
            onClick={() => snapshotMutation.mutate()}
          >
            <RefreshCw className="h-4 w-4" />
            Snapshot now
          </button>
        </div>
        <EmptyState
          icon={Gauge}
          message={
            data?.error
              ? `No quota governor snapshot is readable (${data.error}).`
              : "No persisted quota governor snapshot exists yet."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          disabled={!selectedCompanyId || snapshotMutation.isPending}
          onClick={() => snapshotMutation.mutate()}
        >
          <RefreshCw className="h-4 w-4" />
          Snapshot now
        </button>
      </div>
      <QuotaGovernorPanel snapshot={snapshot} />
    </div>
  );
}
