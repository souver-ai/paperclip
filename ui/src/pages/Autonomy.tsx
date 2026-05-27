import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AutonomyPeriodKey } from "@paperclipai/shared";
import { autonomyApi } from "../api/autonomy";
import { AutonomyView } from "../components/AutonomyView";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

const PERIODS: { key: AutonomyPeriodKey; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
];

export function Autonomy() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState<AutonomyPeriodKey>("24h");

  useEffect(() => {
    setBreadcrumbs([{ label: "Autonomy 24/7" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.autonomy(selectedCompanyId!, period),
    queryFn: () => autonomyApi.get(selectedCompanyId!, period),
    enabled: !!selectedCompanyId,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground">Autonomie Paperclip 24/7</h1>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                period === p.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`period-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {isLoading || !data ? <PageSkeleton variant="dashboard" /> : <AutonomyView report={data} />}
    </div>
  );
}
