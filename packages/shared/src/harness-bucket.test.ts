import { describe, expect, it } from "vitest";
import { harnessBucket } from "./constants.js";

describe("harnessBucket", () => {
  it("maps done + merged/live to delivered", () => {
    expect(harnessBucket("done", "merged_verified", "[Harness] Terminal-Bench baseline")).toBe("delivered");
    expect(harnessBucket("done", "live_verified", "[Benchmark][EXP-049] MCPMark gate")).toBe("delivered");
  });

  it("flags done-but-unmerged and done-non-code", () => {
    expect(harnessBucket("done", "intake", "[Harness P1] SWE-bench baseline")).toBe("delivered_unmerged");
    expect(harnessBucket("done", "intake", "[Test Review] SOU-831 lazy schema coverage")).toBe("done_noncode");
  });

  it("maps in-flight, blocked, queued, abandoned", () => {
    expect(harnessBucket("in_progress", "active_branch", "[Harness] DeepSeek run")).toBe("in_progress");
    expect(harnessBucket("in_review", "in_review", "[Harness] X")).toBe("in_progress");
    expect(harnessBucket("blocked", "intake", "[Harness] Y")).toBe("blocked");
    expect(harnessBucket("todo", "changes_requested", "[Harness] Z")).toBe("blocked");
    expect(harnessBucket("backlog", "intake", "[Benchmark] baseline")).toBe("queued");
    expect(harnessBucket("cancelled", "intake", "[Harness] dropped experiment")).toBe("abandoned");
  });
});
