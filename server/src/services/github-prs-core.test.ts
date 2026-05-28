import { describe, expect, it } from "vitest";
import {
  closedPageExhausted,
  deriveRepoSlugs,
  normalizePull,
  parsePrUrl,
  selectGithubTokenSecret,
  shouldSync,
  type RawGitHubPull,
} from "./github-prs-core.js";

const NOW = new Date("2026-05-28T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("parsePrUrl", () => {
  it("parses a standard PR url", () => {
    expect(parsePrUrl("https://github.com/souver-ai/paperclip/pull/123")).toEqual({
      owner: "souver-ai",
      repo: "paperclip",
      number: 123,
    });
  });
  it("strips .git and ignores trailing segments", () => {
    expect(parsePrUrl("https://github.com/o/r.git/pull/7/files")).toEqual({ owner: "o", repo: "r", number: 7 });
  });
  it("returns null for non-PR or invalid urls", () => {
    expect(parsePrUrl("https://github.com/o/r")).toBeNull();
    expect(parsePrUrl("not a url")).toBeNull();
    expect(parsePrUrl(null)).toBeNull();
  });
});

describe("deriveRepoSlugs", () => {
  it("dedupes and sorts owner/repo slugs from mixed urls", () => {
    expect(
      deriveRepoSlugs([
        "https://github.com/souver-ai/paperclip/pull/1",
        "https://github.com/souver-ai/paperclip/pull/2",
        "https://github.com/souver-ai/dashboard/pull/9",
        null,
        "garbage",
      ]),
    ).toEqual(["souver-ai/dashboard", "souver-ai/paperclip"]);
  });
});

describe("normalizePull", () => {
  const raw: RawGitHubPull = {
    number: 42,
    html_url: "https://github.com/o/r/pull/42",
    state: "closed",
    draft: false,
    title: "Fix things",
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-05-26T10:00:00Z",
    closed_at: "2026-05-26T10:00:00Z",
    merged_at: "2026-05-26T10:00:00Z",
    head: { ref: "feature/x" },
    base: { ref: "main" },
    user: { login: "alice" },
  };
  it("normalizes and marks merged via merged_at", () => {
    const n = normalizePull("o/r", raw)!;
    expect(n).toMatchObject({ repoSlug: "o/r", prNumber: 42, state: "closed", isMerged: true, baseBranch: "main", author: "alice" });
    expect(n.ghMergedAt?.toISOString()).toBe("2026-05-26T10:00:00.000Z");
  });
  it("treats absent merged_at as not merged", () => {
    const n = normalizePull("o/r", { ...raw, merged_at: null })!;
    expect(n.isMerged).toBe(false);
  });
});

describe("closedPageExhausted", () => {
  it("stops once the oldest item is past the horizon", () => {
    const pulls = [
      normalizePull("o/r", { number: 1, html_url: "u", state: "closed", title: "", created_at: "2026-05-27T00:00:00Z", updated_at: "2026-05-27T00:00:00Z", closed_at: null, merged_at: null })!,
      normalizePull("o/r", { number: 2, html_url: "u", state: "closed", title: "", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z", closed_at: null, merged_at: null })!,
    ];
    expect(closedPageExhausted(pulls, NOW, 30 * DAY)).toBe(true);
  });
  it("keeps going while items are within the horizon", () => {
    const pulls = [
      normalizePull("o/r", { number: 1, html_url: "u", state: "closed", title: "", created_at: "2026-05-27T00:00:00Z", updated_at: "2026-05-27T00:00:00Z", closed_at: null, merged_at: null })!,
    ];
    expect(closedPageExhausted(pulls, NOW, 30 * DAY)).toBe(false);
  });
});

describe("selectGithubTokenSecret", () => {
  it("prefers an exact gh_token over migrated agent tokens", () => {
    const secrets = [
      { id: "1", name: "agent_x_github_token" },
      { id: "2", name: "gh_token" },
      { id: "3", name: "agent_x_gh_token" },
    ];
    expect(selectGithubTokenSecret(secrets)?.id).toBe("2");
  });
  it("falls back to an agent gh token when no canonical one exists", () => {
    const secrets = [{ id: "9", name: "agent_x_gh_token" }];
    expect(selectGithubTokenSecret(secrets)?.id).toBe("9");
  });
  it("returns null when nothing matches", () => {
    expect(selectGithubTokenSecret([{ id: "1", name: "openrouter_key" }])).toBeNull();
  });
});

describe("shouldSync", () => {
  const TTL = 10 * 60 * 1000;
  const LOCK = 5 * 60 * 1000;
  it("syncs when never synced", () => {
    expect(shouldSync(null, NOW, TTL, LOCK)).toBe(true);
  });
  it("serves cache within TTL", () => {
    expect(shouldSync({ status: "ok", lastSyncStartedAt: null, lastSyncFinishedAt: new Date(NOW - 60_000) }, NOW, TTL, LOCK)).toBe(false);
  });
  it("re-syncs after TTL", () => {
    expect(shouldSync({ status: "ok", lastSyncStartedAt: null, lastSyncFinishedAt: new Date(NOW - 11 * 60_000) }, NOW, TTL, LOCK)).toBe(true);
  });
  it("respects an in-flight sync until the stale lock expires", () => {
    expect(shouldSync({ status: "syncing", lastSyncStartedAt: new Date(NOW - 60_000), lastSyncFinishedAt: null }, NOW, TTL, LOCK)).toBe(false);
    expect(shouldSync({ status: "syncing", lastSyncStartedAt: new Date(NOW - 6 * 60_000), lastSyncFinishedAt: null }, NOW, TTL, LOCK)).toBe(true);
  });
});
