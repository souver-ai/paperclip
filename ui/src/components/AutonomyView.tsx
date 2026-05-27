import type { AutonomyBucketState, AutonomyReport } from "@paperclipai/shared";
import { cn } from "../lib/utils";

const STATE_COPY: Record<AutonomyBucketState, { label: string; cell: string }> = {
  covered: { label: "Couvert", cell: "bg-green-500 dark:bg-green-600" },
  incident: { label: "Incident", cell: "bg-red-500 dark:bg-red-600" },
  human_gate: { label: "Attente Benjamin", cell: "bg-muted-foreground/40" },
  idle_healthy: { label: "Idle sain", cell: "bg-amber-400 dark:bg-amber-500" },
  absent: { label: "Absent", cell: "bg-muted" },
};
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function pct(value: number | null): string {
  if (value == null) return "n/a";
  return `${value.toFixed(0)}%`;
}

export function AutonomyView({ report }: { report: AutonomyReport }) {
  const { kpis } = report;
  const cellState = new Map<string, AutonomyBucketState>();
  for (const c of report.heatmap) cellState.set(`${c.dayOfWeek}-${c.hour}`, c.state);

  return (
    <div className="space-y-6" data-testid="autonomy-view">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Couverture autonome"
          value={pct(kpis.autonomousCoveragePct)}
          hint={`${kpis.coveredBuckets}/${kpis.actionableBuckets} buckets actionnables`}
          testid="kpi-coverage"
        />
        <MetricCard
          label="Presence 24/7 brute"
          value={pct(kpis.raw247PresencePct)}
          hint={`${kpis.presentBuckets}/${kpis.totalBuckets} buckets actifs`}
        />
        <MetricCard
          label="Incidents autonomie"
          value={String(kpis.incidentBuckets)}
          hint="buckets actionnables sans activite utile"
        />
        <MetricCard
          label="Cout estime"
          value={kpis.estimatedCostCents == null ? "non disponible" : `${(kpis.estimatedCostCents / 100).toFixed(2)} EUR`}
          hint={`${kpis.usefulRuns} runs utiles`}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Heatmap 24/7 (UTC)</h2>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["covered", "incident", "human_gate", "idle_healthy", "absent"] as AutonomyBucketState[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn("h-3 w-3 rounded-sm", STATE_COPY[s].cell)} />
                {STATE_COPY[s].label}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(24, 14px)" }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-[9px] text-muted-foreground">{h}</div>
            ))}
            {DAYS.map((day, d) => (
              <DayRow key={d} day={day} dayIndex={d} cellState={cellState} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Par agent</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 text-right font-medium">Runs</th>
                <th className="px-4 py-3 text-right font-medium">Runs utiles</th>
                <th className="px-4 py-3 text-right font-medium">Echecs</th>
                <th className="px-4 py-3 text-right font-medium">Min. actives</th>
                <th className="px-4 py-3 font-medium">Dernier output</th>
              </tr>
            </thead>
            <tbody>
              {report.agents.length === 0 ? (
                <tr><td className="px-4 py-5 text-muted-foreground" colSpan={6}>Aucun run sur la periode.</td></tr>
              ) : (
                report.agents.map((a) => (
                  <tr key={a.agentId} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{a.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{a.runs}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{a.usefulRuns}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{a.failedRuns}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{a.activeMinutes}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.lastOutputAt ? a.lastOutputAt.replace("T", " ").slice(0, 16) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Incidents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Debut</th>
                <th className="px-4 py-3 text-right font-medium">Duree (min)</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Cause</th>
              </tr>
            </thead>
            <tbody>
              {report.incidents.length === 0 ? (
                <tr><td className="px-4 py-5 text-muted-foreground" colSpan={4}>Aucun incident sur la periode.</td></tr>
              ) : (
                report.incidents.map((inc, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">{inc.startedAt.replace("T", " ").slice(0, 16)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{inc.durationMinutes}</td>
                    <td className="px-4 py-3 text-foreground">{inc.agentName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inc.cause}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DayRow({ day, dayIndex, cellState }: {
  day: string; dayIndex: number; cellState: Map<string, AutonomyBucketState>;
}) {
  return (
    <>
      <div className="pr-2 text-right text-[10px] leading-[14px] text-muted-foreground">{day}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const state = cellState.get(`${dayIndex}-${h}`) ?? "absent";
        return (
          <div
            key={h}
            className={cn("h-[14px] w-[14px] rounded-sm", STATE_COPY[state].cell)}
            title={`${day} ${h}h UTC — ${STATE_COPY[state].label}`}
            data-testid={`cell-${dayIndex}-${h}`}
            data-state={state}
          />
        );
      })}
    </>
  );
}

function MetricCard({ label, value, hint, testid }: { label: string; value: string; hint: string; testid?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid={testid}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
