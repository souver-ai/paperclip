import { describe, expect, it } from "vitest";
import { isInstructionsPathWithinRoots } from "../routes/instructions-path-boundary.js";

describe("isInstructionsPathWithinRoots (SOU-1015 instructions-path boundary)", () => {
  const ws = "/home/agent/workspace";

  it("allows paths inside the workspace root", () => {
    expect(isInstructionsPathWithinRoots(`${ws}/AGENTS.md`, [ws])).toBe(true);
    expect(isInstructionsPathWithinRoots(`${ws}/nested/dir/INSTRUCTIONS.md`, [ws])).toBe(true);
    expect(isInstructionsPathWithinRoots(ws, [ws])).toBe(true);
  });

  it("rejects host-sensitive files outside the workspace", () => {
    expect(isInstructionsPathWithinRoots("/etc/passwd", [ws])).toBe(false);
    expect(isInstructionsPathWithinRoots("/home/agent/.env", [ws])).toBe(false);
    expect(isInstructionsPathWithinRoots("/home/agent/.paperclip.env", [ws])).toBe(false);
  });

  it("rejects sibling directories sharing the root prefix", () => {
    // `/home/agent/workspace-evil` must NOT be treated as inside `/home/agent/workspace`.
    expect(isInstructionsPathWithinRoots(`${ws}-evil/secret`, [ws])).toBe(false);
  });

  it("rejects `..` traversal that resolves outside the workspace", () => {
    expect(isInstructionsPathWithinRoots(`${ws}/../../etc/passwd`, [ws])).toBe(false);
    expect(isInstructionsPathWithinRoots(`${ws}/sub/../../..//etc/passwd`, [ws])).toBe(false);
  });

  it("accepts `..` traversal that stays within the workspace", () => {
    expect(isInstructionsPathWithinRoots(`${ws}/sub/../AGENTS.md`, [ws])).toBe(true);
  });

  it("ignores empty / nullish roots", () => {
    expect(isInstructionsPathWithinRoots("/etc/passwd", [null, undefined, ""])).toBe(false);
  });

  it("matches against any of several allowed roots", () => {
    const bundleRoot = "/var/paperclip/bundles/agent-1";
    expect(isInstructionsPathWithinRoots(`${bundleRoot}/AGENTS.md`, [ws, bundleRoot])).toBe(true);
    expect(isInstructionsPathWithinRoots("/etc/passwd", [ws, bundleRoot])).toBe(false);
  });
});
