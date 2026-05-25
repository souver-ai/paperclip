import type { IssueCategory, IssueSurface } from "@paperclipai/shared";
import { cn } from "../lib/utils";
import { labelTaxonomyValue, normalizeIssueCategory, normalizeIssueSurfaces } from "../lib/issue-taxonomy";

export function IssueTaxonomyChips({
  category,
  surfaces,
  compact = false,
  className,
}: {
  category?: IssueCategory | string | null;
  surfaces?: IssueSurface[] | string[] | null;
  compact?: boolean;
  className?: string;
}) {
  const normalizedCategory = normalizeIssueCategory(category);
  const normalizedSurfaces = normalizeIssueSurfaces(surfaces);
  const showCategory = normalizedCategory !== "uncategorized";
  if (!showCategory && normalizedSurfaces.length === 0) return null;

  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {showCategory ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded border border-sky-500/35 bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300",
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
          )}
          title={`Category: ${labelTaxonomyValue(normalizedCategory)}`}
        >
          {labelTaxonomyValue(normalizedCategory)}
        </span>
      ) : null}
      {normalizedSurfaces.map((surface) => (
        <span
          key={surface}
          className={cn(
            "inline-flex shrink-0 items-center rounded border border-emerald-500/35 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300",
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
          )}
          title={`Surface: ${labelTaxonomyValue(surface)}`}
        >
          {labelTaxonomyValue(surface)}
        </span>
      ))}
    </span>
  );
}
