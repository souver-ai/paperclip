import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { githubPrSyncState, pullRequestSnapshots, repoLocks, verificationRuns } from "@paperclipai/db";
import type {
  PullRequestActivity,
  PullRequestRepoSyncResult,
  PullRequestSnapshot,
  PullRequestSyncStatus,
} from "@paperclipai/shared";
import { ghFetch, gitHubApiBase } from "./github-fetch.js";
import { secretService } from "./secrets.js";
import {
  closedPageExhausted,
  deriveRepoSlugs,
  normalizePull,
  selectGithubTokenSecret,
  shouldSync,
  type NormalizedPull,
  type RawGitHubPull,
} from "./github-prs-core.js";

const TTL_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 5 * 60 * 1000;
const CLOSED_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MAX_CLOSED_PAGES = 3;
const FETCH_TIMEOUT_MS = 15_000;

export function githubPrService(db: Db) {
  const secrets = secretService(db);

  async function readState(companyId: string) {
    const rows = await db.select().from(githubPrSyncState).where(eq(githubPrSyncState.companyId, companyId));
    return rows[0] ?? null;
  }

  async function deriveRepos(companyId: string): Promise<string[]> {
    const [locks, runs] = await Promise.all([
      db
        .select({ prUrl: repoLocks.prUrl })
        .from(repoLocks)
        .where(and(eq(repoLocks.companyId, companyId), isNotNull(repoLocks.prUrl))),
      db
        .select({ prUrl: verificationRuns.prUrl })
        .from(verificationRuns)
        .where(and(eq(verificationRuns.companyId, companyId), isNotNull(verificationRuns.prUrl))),
    ]);
    return deriveRepoSlugs([...locks, ...runs].map((r) => r.prUrl));
  }

  async function resolveToken(companyId: string): Promise<string | null> {
    const all = await secrets.list(companyId);
    const picked = selectGithubTokenSecret(all.map((s) => ({ id: s.id, name: s.name, key: s.key })));
    if (!picked) return null;
    try {
      return await secrets.resolveSecretValue(companyId, picked.id, "latest");
    } catch {
      return null;
    }
  }

  async function fetchPulls(
    apiBase: string,
    slug: string,
    token: string,
    state: "open" | "closed",
    now: number,
  ): Promise<NormalizedPull[]> {
    const out: NormalizedPull[] = [];
    const maxPages = state === "open" ? 5 : MAX_CLOSED_PAGES;
    for (let page = 1; page <= maxPages; page += 1) {
      const sort = state === "closed" ? "&sort=updated&direction=desc" : "";
      const url = `${apiBase}/repos/${slug}/pulls?state=${state}&per_page=${PER_PAGE}&page=${page}${sort}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await ghFetch(url, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error(`GitHub ${res.status} for ${slug} (${state})`);
      }
      const raw = (await res.json()) as RawGitHubPull[];
      if (!Array.isArray(raw) || raw.length === 0) break;
      const normalized = raw.map((p) => normalizePull(slug, p)).filter((p): p is NormalizedPull => p != null);
      out.push(...normalized);
      if (state === "closed" && closedPageExhausted(normalized, now, CLOSED_HORIZON_MS)) break;
      if (raw.length < PER_PAGE) break;
    }
    // For closed PRs we only persist those within the horizon to bound growth.
    return state === "closed"
      ? out.filter((p) => p.ghUpdatedAt.getTime() >= now - CLOSED_HORIZON_MS)
      : out;
  }

  async function upsertPulls(companyId: string, pulls: NormalizedPull[], syncedAt: Date) {
    for (const p of pulls) {
      await db
        .insert(pullRequestSnapshots)
        .values({
          companyId,
          repoSlug: p.repoSlug,
          prNumber: p.prNumber,
          prUrl: p.prUrl,
          title: p.title,
          state: p.state,
          isDraft: p.isDraft,
          isMerged: p.isMerged,
          headBranch: p.headBranch,
          baseBranch: p.baseBranch,
          author: p.author,
          ghCreatedAt: p.ghCreatedAt,
          ghUpdatedAt: p.ghUpdatedAt,
          ghClosedAt: p.ghClosedAt,
          ghMergedAt: p.ghMergedAt,
          lastSyncedAt: syncedAt,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: [pullRequestSnapshots.companyId, pullRequestSnapshots.repoSlug, pullRequestSnapshots.prNumber],
          set: {
            prUrl: p.prUrl,
            title: p.title,
            state: p.state,
            isDraft: p.isDraft,
            isMerged: p.isMerged,
            headBranch: p.headBranch,
            baseBranch: p.baseBranch,
            author: p.author,
            ghCreatedAt: p.ghCreatedAt,
            ghUpdatedAt: p.ghUpdatedAt,
            ghClosedAt: p.ghClosedAt,
            ghMergedAt: p.ghMergedAt,
            lastSyncedAt: syncedAt,
            updatedAt: syncedAt,
          },
        });
    }
  }

  async function writeState(
    companyId: string,
    patch: {
      status: PullRequestSyncStatus;
      startedAt?: Date;
      finishedAt?: Date | null;
      error?: string | null;
      repos?: PullRequestRepoSyncResult[];
    },
  ) {
    const now = new Date();
    await db
      .insert(githubPrSyncState)
      .values({
        companyId,
        status: patch.status,
        lastSyncStartedAt: patch.startedAt ?? null,
        lastSyncFinishedAt: patch.finishedAt ?? null,
        error: patch.error ?? null,
        reposSynced: patch.repos ?? [],
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: githubPrSyncState.companyId,
        set: {
          status: patch.status,
          ...(patch.startedAt ? { lastSyncStartedAt: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { lastSyncFinishedAt: patch.finishedAt } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.repos !== undefined ? { reposSynced: patch.repos } : {}),
          updatedAt: now,
        },
      });
  }

  async function syncCompany(companyId: string): Promise<void> {
    const startedAt = new Date();
    await writeState(companyId, { status: "syncing", startedAt });

    const token = await resolveToken(companyId);
    if (!token) {
      await writeState(companyId, {
        status: "error",
        finishedAt: new Date(),
        error: "No GitHub token secret found (expected gh_token).",
        repos: [],
      });
      return;
    }

    const slugs = await deriveRepos(companyId);
    const apiBase = gitHubApiBase("github.com");
    const now = startedAt.getTime();
    const results: PullRequestRepoSyncResult[] = [];

    for (const slug of slugs) {
      try {
        const [open, closed] = await Promise.all([
          fetchPulls(apiBase, slug, token, "open", now),
          fetchPulls(apiBase, slug, token, "closed", now),
        ]);
        const pulls = [...open, ...closed];
        await upsertPulls(companyId, pulls, startedAt);
        results.push({ slug, ok: true, count: pulls.length });
      } catch (err) {
        results.push({ slug, ok: false, count: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const allFailed = results.length > 0 && results.every((r) => !r.ok);
    await writeState(companyId, {
      status: allFailed ? "error" : "ok",
      finishedAt: new Date(),
      error: allFailed ? "All repositories failed to sync." : null,
      repos: results,
    });
  }

  async function listSnapshots(companyId: string): Promise<PullRequestSnapshot[]> {
    const rows = await db
      .select()
      .from(pullRequestSnapshots)
      .where(eq(pullRequestSnapshots.companyId, companyId))
      .orderBy(desc(pullRequestSnapshots.ghUpdatedAt));
    return rows as unknown as PullRequestSnapshot[];
  }

  async function getActivity(companyId: string): Promise<PullRequestActivity> {
    const state = await readState(companyId);
    if (shouldSync(state, Date.now(), TTL_MS, STALE_LOCK_MS)) {
      try {
        await syncCompany(companyId);
      } catch (err) {
        await writeState(companyId, {
          status: "error",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const [pulls, finalState] = await Promise.all([listSnapshots(companyId), readState(companyId)]);
    return {
      pullRequests: pulls,
      status: (finalState?.status as PullRequestSyncStatus) ?? "idle",
      syncedAt: finalState?.lastSyncFinishedAt ?? null,
      repos: (finalState?.reposSynced as PullRequestRepoSyncResult[]) ?? [],
      error: finalState?.error ?? null,
    };
  }

  return { getActivity, syncCompany, listSnapshots };
}
