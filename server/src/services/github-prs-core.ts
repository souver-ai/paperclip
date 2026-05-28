// Pure, dependency-free helpers for the GitHub PR sync.
//
// Everything here is side-effect free (no db, no network, no clock) so it can
// be unit-tested deterministically. The orchestration that touches the db,
// GitHub, and secrets lives in github-prs.ts.

export interface ParsedPrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse a GitHub PR URL like https://github.com/owner/repo/pull/123. */
export function parsePrUrl(rawUrl: string | null | undefined): ParsedPrRef | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com" && !host.endsWith(".github.com")) {
    // Allow GitHub Enterprise hosts too; we only need owner/repo/number.
  }
  const parts = url.pathname.split("/").filter(Boolean);
  // .../owner/repo/pull/123
  const pullIdx = parts.findIndex((p) => p === "pull" || p === "pulls");
  if (pullIdx < 2) return null;
  const owner = parts[pullIdx - 2];
  const repo = parts[pullIdx - 1]?.replace(/\.git$/i, "");
  const number = Number.parseInt(parts[pullIdx + 1] ?? "", 10);
  if (!owner || !repo || !Number.isFinite(number)) return null;
  return { owner, repo, number };
}

/** Derive the unique set of "owner/repo" slugs from a list of PR URLs. */
export function deriveRepoSlugs(prUrls: (string | null | undefined)[]): string[] {
  const slugs = new Set<string>();
  for (const url of prUrls) {
    const parsed = parsePrUrl(url);
    if (parsed) slugs.add(`${parsed.owner}/${parsed.repo}`);
  }
  return [...slugs].sort();
}

// Minimal shape of a GitHub "pull request" object from the list endpoint.
export interface RawGitHubPull {
  number: number;
  html_url: string;
  state: string; // "open" | "closed"
  draft?: boolean;
  title: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  head?: { ref?: string } | null;
  base?: { ref?: string } | null;
  user?: { login?: string } | null;
}

export interface NormalizedPull {
  repoSlug: string;
  prNumber: number;
  prUrl: string;
  title: string;
  state: "open" | "closed";
  isDraft: boolean;
  isMerged: boolean;
  headBranch: string | null;
  baseBranch: string | null;
  author: string | null;
  ghCreatedAt: Date;
  ghUpdatedAt: Date;
  ghClosedAt: Date | null;
  ghMergedAt: Date | null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizePull(repoSlug: string, raw: RawGitHubPull): NormalizedPull | null {
  const created = parseDate(raw.created_at);
  const updated = parseDate(raw.updated_at);
  if (!created || !updated || !Number.isFinite(raw.number)) return null;
  return {
    repoSlug,
    prNumber: raw.number,
    prUrl: raw.html_url,
    title: raw.title ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    isDraft: Boolean(raw.draft),
    isMerged: Boolean(raw.merged_at),
    headBranch: raw.head?.ref ?? null,
    baseBranch: raw.base?.ref ?? null,
    author: raw.user?.login ?? null,
    ghCreatedAt: created,
    ghUpdatedAt: updated,
    ghClosedAt: parseDate(raw.closed_at),
    ghMergedAt: parseDate(raw.merged_at),
  };
}

/**
 * Decide whether to keep paginating closed PRs. We only care about PRs updated
 * within `horizonMs` of `now`; the closed list is sorted updated-desc, so once
 * we see one older than the horizon we can stop.
 */
export function closedPageExhausted(
  pulls: NormalizedPull[],
  now: number,
  horizonMs: number,
): boolean {
  if (pulls.length === 0) return true;
  const oldest = pulls[pulls.length - 1];
  return oldest.ghUpdatedAt.getTime() < now - horizonMs;
}

// --- Token selection ------------------------------------------------------

export interface SecretLike {
  id: string;
  name: string;
  key?: string | null;
}

// Preference order for which secret holds a usable GitHub token.
const TOKEN_NAME_PRIORITY = [/^gh_token$/i, /^github_token$/i, /gh_token$/i, /github_token$/i, /(^|_)gh(_|$)/i];

/** Pick the most appropriate GitHub token secret from the company's secrets. */
export function selectGithubTokenSecret<T extends SecretLike>(secrets: T[]): T | null {
  for (const pattern of TOKEN_NAME_PRIORITY) {
    const hit = secrets.find((s) => pattern.test(s.name) || (s.key != null && pattern.test(s.key)));
    if (hit) return hit;
  }
  return null;
}

// --- Lazy-sync gating ------------------------------------------------------

export interface SyncStateLike {
  status: string | null;
  lastSyncStartedAt: Date | null;
  lastSyncFinishedAt: Date | null;
}

/**
 * Should we trigger a fresh sync on this read? Yes when we have never synced,
 * the last sync is older than the TTL, or a previous sync claimed "syncing"
 * but stalled past the stale-lock window (so a crashed sync can't wedge it).
 */
export function shouldSync(
  state: SyncStateLike | null,
  now: number,
  ttlMs: number,
  staleLockMs: number,
): boolean {
  if (!state) return true;
  if (state.status === "syncing") {
    const started = state.lastSyncStartedAt?.getTime() ?? 0;
    return now - started > staleLockMs;
  }
  const finished = state.lastSyncFinishedAt?.getTime() ?? 0;
  return now - finished > ttlMs;
}
