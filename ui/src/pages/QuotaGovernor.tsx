import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
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

  useEffect(() => {
    setBreadcrumbs([{ label: "Quota Governor" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.quotaGovernor(selectedCompanyId!),
    queryFn: () => quotaGovernorApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });

  if (isLoading) return <PageSkeleton variant="dashboard" />;

  const snapshot = data?.snapshot ?? null;
  if (!snapshot) {
    return (
      <EmptyState
        icon={Gauge}
        message={
          data?.error
            ? `Aucun rapport quota governor lisible (${data.error}).`
            : "Aucun rapport quota governor disponible. Le reporter ops/paperclip doit en produire un."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <QuotaGovernorPanel snapshot={snapshot} />
    </div>
  );
}
