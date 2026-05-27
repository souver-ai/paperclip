import { describe, expect, it } from "vitest";
import { featureBucket } from "./constants.js";

describe("featureBucket", () => {
  it("maps delivered intake with a merged delivery state to delivered", () => {
    expect(featureBucket("delivered", "merged_verified")).toBe("delivered");
    expect(featureBucket("delivered", "live_verified")).toBe("delivered");
    expect(featureBucket("delivered", "waived_by_benjamin")).toBe("delivered");
  });

  it("flags delivered intake that never reached main as done-but-unmerged", () => {
    expect(featureBucket("delivered", "active_branch")).toBe("delivered_unmerged");
    expect(featureBucket("delivered", "pr_ready")).toBe("delivered_unmerged");
    expect(featureBucket("delivered", "intake")).toBe("delivered_unmerged");
  });

  it("maps rejected to abandoned and parked to parked", () => {
    expect(featureBucket("rejected", "active_branch")).toBe("abandoned");
    expect(featureBucket("parked", "parked_hold")).toBe("parked");
  });

  it("groups in-flight statuses", () => {
    expect(featureBucket("in_delivery", "active_branch")).toBe("in_delivery");
    expect(featureBucket("selected", "queued_repo_gate")).toBe("in_delivery");
    expect(featureBucket("queued", "intake")).toBe("queued");
    expect(featureBucket("ready_for_priority", "intake")).toBe("queued");
    expect(featureBucket("proposed", "intake")).toBe("queued");
  });
});
