import { type ReactNode } from "react";
import { Link } from "@/lib/router";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ExternalLink, Minus } from "lucide-react";
import {
  deltaLabel,
  formatAge,
  WINDOW_OPTIONS,
  type AttentionItem,
  type AttentionSeverity,
  type DataHealth,
  type HealthState,
  type Kpi,
  type SourceHealth,
  type WindowKey,
} from "../lib/controlTowerMetrics";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Freshness primitives
// ---------------------------------------------------------------------------

const HEALTH_DOT: Record<HealthState, string> = {
  ok: "bg-emerald-500",
  stale: "bg-amber-500",
  empty: "bg-muted-foreground/40",
};

const HEALTH_TEXT: Record<HealthState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  empty: "text-muted-foreground",
};

function healthLabel(health: DataHealth, producer: string): string {
  if (health.state === "empty") return `Aucune donnée · producteur attendu : ${producer}`;
  if (health.state === "stale") return `Silencieux depuis ${formatAge(health.ageMs)} · ${producer}`;
  return `Mis à jour il y a ${formatAge(health.ageMs)} · ${producer}`;
}

function FreshnessDot({ health, producer }: { health: DataHealth; producer: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[health.state])}
      title={healthLabel(health, producer)}
    />
  );
}

// ---------------------------------------------------------------------------
// Sparkline (self-contained inline SVG, no chart dependency)
// ---------------------------------------------------------------------------

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 72;
  const h = 22;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-5 w-[72px] text-muted-foreground/70", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Window toggle
// ---------------------------------------------------------------------------

export function WindowToggle({ value, onChange }: { value: WindowKey; onChange: (w: WindowKey) => void }) {
  return (
    <div className="inline-flex items-center border border-border bg-card text-xs">
      {WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "px-3 py-1.5 font-medium transition-colors",
            value === opt.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function DeltaChip({ kpi }: { kpi: Kpi }) {
  const label = deltaLabel(kpi);
  if (label == null) return null;
  const diff = (kpi.value ?? 0) - (kpi.previous ?? 0);
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const tone = diff > 0 ? "text-emerald-600 dark:text-emerald-400" : diff < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", tone)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function CardShell({ href, children }: { href: string; children: ReactNode }) {
  const cls =
    "group block min-w-0 border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/30 hover:bg-accent/30";
  if (href.startsWith("#")) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={cls}>
      {children}
    </Link>
  );
}

function PulseCard({ kpi }: { kpi: Kpi }) {
  const unknown = kpi.health.state === "empty";
  return (
    <CardShell href={kpi.href}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FreshnessDot health={kpi.health} producer={kpi.producer} />
          <span className="truncate">{kpi.label}</span>
        </div>
        {kpi.confidence === "proxy" ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70" title={kpi.note}>
            proxy
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          {unknown ? (
            <span className="text-2xl font-semibold text-muted-foreground/50" title={healthLabel(kpi.health, kpi.producer)}>
              —
            </span>
          ) : (
            <span className="text-2xl font-semibold tabular-nums">{kpi.value}</span>
          )}
          {!unknown ? <DeltaChip kpi={kpi} /> : null}
        </div>
        {!unknown && kpi.mode === "window" ? <Sparkline values={kpi.trend} /> : null}
      </div>

      <div className={cn("mt-1 truncate text-[11px]", unknown ? HEALTH_TEXT.empty : "text-muted-foreground")}>
        {unknown
          ? `Aucune donnée · ${kpi.producer}`
          : kpi.mode === "snapshot"
            ? kpi.note ?? "instantané"
            : kpi.note ?? `vs période précédente · ${kpi.producer}`}
      </div>
    </CardShell>
  );
}

export function PulseStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi) => (
        <PulseCard key={kpi.key} kpi={kpi} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attention queue
// ---------------------------------------------------------------------------

const SEVERITY_BORDER: Record<AttentionSeverity, string> = {
  danger: "border-l-red-500",
  warning: "border-l-amber-500",
  info: "border-l-sky-500",
};

const SEVERITY_TEXT: Record<AttentionSeverity, string> = {
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
};

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  return (
    <section className="min-w-0 border border-border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">À traiter</h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Rien à traiter — aucune alerte, aucun producteur silencieux.
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 12).map((item) => (
              <div key={item.key} className={cn("border border-l-2 border-border px-3 py-2", SEVERITY_BORDER[item.severity])}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-[10px] font-medium uppercase tracking-wide", SEVERITY_TEXT[item.severity])}>
                    {item.category}
                  </span>
                  {item.prUrl ? (
                    <a
                      href={item.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      PR <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-sm font-medium" title={item.title}>
                  {item.title}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</div>
              </div>
            ))}
            {items.length > 12 ? (
              <div className="pt-1 text-center text-xs text-muted-foreground">+{items.length - 12} de plus</div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Source health row
// ---------------------------------------------------------------------------

export function SourceHealthRow({ sources }: { sources: SourceHealth[] }) {
  return (
    <section className="min-w-0 border border-border bg-card">
      <div className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Santé des sources</h2>
        <span className="text-xs text-muted-foreground">qui alimente quoi, et depuis quand</span>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
        {sources.map((src) => (
          <div key={src.key} className="bg-card px-4 py-3">
            <div className="flex items-center gap-1.5">
              <FreshnessDot health={src.health} producer={src.producer} />
              <span className="truncate text-sm font-medium">{src.label}</span>
            </div>
            <div className={cn("mt-1 text-xs", HEALTH_TEXT[src.health.state])}>
              {src.health.state === "empty" ? "aucune donnée" : src.health.state === "stale" ? `silencieux ${formatAge(src.health.ageMs)}` : `maj ${formatAge(src.health.ageMs)}`}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={src.producer}>
              {src.producer}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
