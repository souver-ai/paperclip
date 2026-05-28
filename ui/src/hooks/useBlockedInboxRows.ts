import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import {
  applyIssueFilters,
  type IssueFilterState,
  type IssueFilterWorkspaceContext,
} from "../lib/issue-filters";
import {
  blockedRowMatchesSearch,
  buildBlockedInboxRows,
  type BlockedInboxIssueRow,
} from "../lib/blockedInbox";

export const BLOCKED_LIST_LIMIT = 200;

interface UseBlockedInboxRowsParams {
  companyId: string;
  searchQuery: string;
  issueFilters: IssueFilterState;
  currentUserId: string | null;
  liveIssueIds: ReadonlySet<string>;
  workspaceFilterContext: IssueFilterWorkspaceContext;
  /** Skip fetching when the Blocked data isn't needed yet. Defaults to true. */
  enabled?: boolean;
}

/**
 * Fetches the Blocked inbox issues and derives the rows shown in the Blocked
 * tab. Shared between the Blocked tab badge (Inbox) and BlockedInboxView so the
 * displayed count stays in sync with the rows actually rendered. The query is
 * keyed by company so both consumers dedupe to a single network request.
 */
export function useBlockedInboxRows({
  companyId,
  searchQuery,
  issueFilters,
  currentUserId,
  liveIssueIds,
  workspaceFilterContext,
  enabled = true,
}: UseBlockedInboxRowsParams) {
  const query = useQuery({
    queryKey: queryKeys.issues.listBlockedAttention(companyId),
    queryFn: () =>
      issuesApi.list(companyId, {
        attention: "blocked",
        includeBlockedInboxAttention: true,
        includeBlockedBy: true,
        limit: BLOCKED_LIST_LIMIT,
      }),
    enabled,
  });

  const issues = query.data ?? ([] as Issue[]);
  const allRows = useMemo(() => buildBlockedInboxRows(issues), [issues]);
  const filteredRows = useMemo(
    () => allRows.filter((row) => blockedRowMatchesSearch(row, searchQuery)),
    [allRows, searchQuery],
  );
  const issueFilteredRows = useMemo<BlockedInboxIssueRow[]>(() => {
    const visibleIssueIds = new Set(
      applyIssueFilters(
        filteredRows.map((row) => row.issue),
        issueFilters,
        currentUserId,
        true,
        liveIssueIds,
        workspaceFilterContext,
      ).map((issue) => issue.id),
    );
    return filteredRows.filter((row) => visibleIssueIds.has(row.issue.id));
  }, [currentUserId, filteredRows, issueFilters, liveIssueIds, workspaceFilterContext]);

  return {
    ...query,
    issues,
    allRows,
    filteredRows,
    issueFilteredRows,
    count: issueFilteredRows.length,
  };
}
