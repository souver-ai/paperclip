import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractCompanyPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123/routines", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/search")).toBe(true);
    expect(extractCompanyPrefixFromPath("/search")).toBeNull();
    expect(applyCompanyPrefix("/search", "PAP")).toBe("/PAP/search");
    expect(applyCompanyPrefix("/search?q=hello%20world", "PAP")).toBe("/PAP/search?q=hello%20world");
    expect(toCompanyRelativePath("/PAP/search?q=foo")).toBe("/search?q=foo");
  });

  it("routes approvals through the active company prefix", () => {
    expect(isBoardPathWithoutPrefix("/approvals/pending")).toBe(true);
    expect(extractCompanyPrefixFromPath("/approvals/pending")).toBeNull();
    expect(applyCompanyPrefix("/approvals/pending", "SOU")).toBe("/SOU/approvals/pending");
    expect(toCompanyRelativePath("/SOU/approvals/approval-123")).toBe("/approvals/approval-123");
  });

  it("treats harness and tests as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/harness")).toBe(true);
    expect(isBoardPathWithoutPrefix("/tests")).toBe(true);
    expect(extractCompanyPrefixFromPath("/harness")).toBeNull();
    expect(applyCompanyPrefix("/harness", "SOU")).toBe("/SOU/harness");
    expect(applyCompanyPrefix("/tests/run-42", "SOU")).toBe("/SOU/tests/run-42");
    expect(toCompanyRelativePath("/SOU/harness")).toBe("/harness");
    expect(toCompanyRelativePath("/SOU/tests/run-42")).toBe("/tests/run-42");
  });

  it("routes all core sidebar board links through the active company prefix", () => {
    const sidebarPaths = [
      "/dashboard",
      "/control-tower",
      "/quota-governor",
      "/autonomy",
      "/inbox",
      "/approvals/pending",
      "/issues",
      "/features",
      "/harness",
      "/tests",
      "/routines",
      "/goals",
      "/workspaces",
      "/org",
      "/skills",
      "/costs",
      "/activity",
      "/company/settings",
      "/search",
    ];

    for (const path of sidebarPaths) {
      expect(isBoardPathWithoutPrefix(path)).toBe(true);
      expect(extractCompanyPrefixFromPath(path)).toBeNull();
      expect(applyCompanyPrefix(path, "SOU")).toBe(`/SOU${path}`);
      expect(toCompanyRelativePath(`/SOU${path}`)).toBe(path);
    }
  });
});
