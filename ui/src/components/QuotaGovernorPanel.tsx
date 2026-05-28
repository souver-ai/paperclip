import type {
  QuotaGovernorBand,
  QuotaGovernorCadenceEffect,
  QuotaGovernorSnapshot,
} from "@paperclipai/shared";
import { cn } from "../lib/utils";

const bandCopy: Record<
  QuotaGovernorBand,
  { label: string; className: string; description: string }
> = {
  under_target: {
    label: "Sous cible",
    className:
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300",
    description: "La projection finit sous la trajectoire cible.",
  },
  on_target: {
    label: "Sur cible",
    className:
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300",
    description: "La projection reste dans la bande de securite.",
  },
  over_target: {
    label: "Au-dessus cible",
    className:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300",
    description: "La projection finit au-dessus de la trajectoire cible.",
  },
  unknown: {
    label: "Indetermine",
    className: "border-border bg-muted text-muted-foreground",
    description: "Le rapport ne contient pas encore assez de donnees.",
  },
};

const cadenceCopy: Record<QuotaGovernorCadenceEffect, string> = {
  helping: "La cadence actuelle aide la trajectoire cible.",
  hurting: "La cadence actuelle tire la trajectoire hors cible.",
  neutral: "La cadence actuelle ne demande pas de mutation.",
  unknown: "Effet cadence non determine dans le dernier rapport.",
};

export function QuotaGovernorPanel({ snapshot }: { snapshot: QuotaGovernorSnapshot }) {
  const band = bandCopy[snapshot.band];
  const topDrivers = snapshot.drivers
    .slice()
    .sort((a, b) => b.runsPerDay - a.runsPerDay)
    .slice(0, 5);

  return (
    <div className="space-y-6" data-testid="quota-governor-panel">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Paperclip quota governor
            </p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">Codex weekly quota and cadence</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Source: {snapshot.quotaSource || "native quota snapshot"}. Latest snapshot:{" "}
              {snapshot.generatedAt ?? "unknown date"}.
            </p>
          </div>
          <span
            className={cn("w-fit rounded border px-3 py-1 text-sm font-semibold", band.className)}
            data-testid="quota-governor-band"
          >
            {band.label}
          </span>
        </div>
        <p className="mt-4 text-sm text-foreground/80">{band.description}</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard
          label="Quota restant"
          value={formatEur(snapshot.remainingCents)}
          hint={`${formatEur(snapshot.spentCents)} consommes sur ${formatEur(snapshot.quotaCents)}`}
        />
        <MetricCard
          label="Burn observe"
          value={`${formatEur(snapshot.dailyBurnCents)} / jour`}
          hint={`${snapshot.elapsedDays.toFixed(1)} jours observes`}
        />
        <MetricCard
          label="Fin de periode"
          value={formatEur(snapshot.projectedEndCents)}
          hint={`${formatPercent(snapshot.projectedUtilization)} du quota`}
        />
        <MetricCard
          label="Confiance forecast"
          value={confidenceLabel(snapshot.confidence)}
          hint={`Threshold ${formatPercent(snapshot.targetUtilization)}; reset ${snapshot.resetAt ? formatDate(snapshot.resetAt) : "unknown"}`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Forecast vs trajectoire</h2>
            <span className="text-xs text-muted-foreground">
              {snapshot.remainingDays.toFixed(1)} jours restants
            </span>
          </div>
          <div className="space-y-4">
            <ProgressRow label="Consomme" value={snapshot.spentCents} max={snapshot.quotaCents} colorClass="bg-foreground" />
            <ProgressRow
              label="Projection"
              value={snapshot.projectedEndCents}
              max={snapshot.quotaCents}
              colorClass={
                snapshot.band === "over_target"
                  ? "bg-red-600"
                  : snapshot.band === "under_target"
                    ? "bg-blue-600"
                    : "bg-green-600"
              }
            />
            <ProgressRow label="Cible" value={snapshot.targetCents} max={snapshot.quotaCents} colorClass="bg-amber-500" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Action recommandee</h2>
          <p className="mt-3 text-2xl font-bold text-foreground" data-testid="quota-governor-action">
            {snapshot.recommendationAction}
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            {snapshot.recommendationSummary || snapshot.summary}
          </p>
          {snapshot.recommendationRationale && (
            <p className="mt-3 text-xs text-muted-foreground">{snapshot.recommendationRationale}</p>
          )}
          <div className="mt-4 rounded border border-border bg-muted p-3 text-xs text-muted-foreground">
            {cadenceCopy[snapshot.cadenceEffect]} Approval native requise:{" "}
            {snapshot.approvalRequired ? "oui" : "non"}.
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Principaux drivers de cadence</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Cadence</th>
                <th className="px-4 py-3 text-right font-medium">Runs/jour</th>
              </tr>
            </thead>
            <tbody>
              {topDrivers.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-muted-foreground" colSpan={4}>
                    Aucun driver cadence dans le rapport.
                  </td>
                </tr>
              ) : (
                topDrivers.map((driver) => (
                  <tr key={`${driver.kind}-${driver.name}`} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">{driver.kind}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{driver.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{driver.cadence}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {driver.runsPerDay.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Cadence diff</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Previous</th>
                <th className="px-4 py-3 font-medium">Next</th>
                <th className="px-4 py-3 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.cadenceChanges ?? []).length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-muted-foreground" colSpan={5}>
                    No cadence changes proposed for this snapshot.
                  </td>
                </tr>
              ) : (
                (snapshot.cadenceChanges ?? []).map((change) => (
                  <tr key={`${change.targetType}-${change.targetId}-${change.field}`} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{change.targetName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{change.field}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(change.previousValue)}</td>
                    <td className="px-4 py-3 text-foreground">{String(change.nextValue)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {change.applied ? "applied" : "proposed"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground/70">
        Snapshot source: {snapshot.reportPath}. Cadence data comes from native agent heartbeat config
        and routine triggers; no customer data is read.
      </p>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ProgressRow({
  label,
  value,
  max,
  colorClass,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 120) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {formatEur(value)} ({formatPercent(max > 0 ? value / max : 0)})
        </span>
      </div>
      <div className="h-2 rounded bg-muted">
        <div className={cn("h-2 rounded", colorClass)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function formatEur(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function confidenceLabel(confidence: QuotaGovernorSnapshot["confidence"]): string {
  if (confidence === "high") return "Haute";
  if (confidence === "medium") return "Moyenne";
  return "Basse";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
