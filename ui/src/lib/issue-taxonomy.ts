import {
  ISSUE_CATEGORIES,
  ISSUE_SURFACES,
  type IssueCategory,
  type IssueSurface,
} from "@paperclipai/shared";

export const issueCategoryOptions = ISSUE_CATEGORIES.map((value) => ({
  value,
  label: labelTaxonomyValue(value),
}));

export const issueSurfaceOptions = ISSUE_SURFACES.map((value) => ({
  value,
  label: labelTaxonomyValue(value),
}));

export function labelTaxonomyValue(value: string | null | undefined): string {
  if (!value) return "Uncategorized";
  if (value === "app_cli") return "App CLI";
  if (value === "kb_docs") return "KB / Docs";
  if (value === "parent_kb_ops") return "Parent KB / Ops";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeIssueCategory(value: string | null | undefined): IssueCategory {
  return ISSUE_CATEGORIES.includes(value as IssueCategory) ? (value as IssueCategory) : "uncategorized";
}

export function normalizeIssueSurfaces(value: unknown): IssueSurface[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is IssueSurface => ISSUE_SURFACES.includes(entry as IssueSurface));
}
