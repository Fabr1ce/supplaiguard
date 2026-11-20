import { describe, expect, it } from "vitest";
import { outcome } from "./format";
import { buildStages } from "../components/execution/WorkflowTimeline";

describe("outcome", () => {
  it("maps GitHub states to the six UI states", () => {
    expect(outcome(undefined, null)).toBe("ready");
    expect(outcome("queued", null)).toBe("queued");
    expect(outcome("in_progress", null)).toBe("in_progress");
    expect(outcome("completed", "success")).toBe("success");
    expect(outcome("completed", "cancelled")).toBe("cancelled");
    expect(outcome("completed", "failure")).toBe("failure");
    expect(outcome("completed", "failed_to_start")).toBe("failure");
  });
});

describe("buildStages", () => {
  it("shows real step states and does not invent progress", () => {
    const st = buildStages([
      { name: "triage (crypt-keeper-mcp)", status: "in_progress", conclusion: null, steps: [
        { name: "Deterministic scan of the original demo (no secrets)", status: "completed", conclusion: "success" },
        { name: "Headless triage inside the demo copy (read-only)", status: "in_progress", conclusion: null },
      ] },
    ]);
    expect(st.map((s) => s.state)).toEqual(["done", "active", "pending", "pending", "pending"]);
  });
  it("marks a skipped agent step as skipped", () => {
    const st = buildStages([{ name: "triage (x)", status: "completed", conclusion: "success", steps: [{ name: "Headless triage inside the demo copy (read-only)", status: "completed", conclusion: "skipped" }] }]);
    expect(st[1].state).toBe("skipped");
  });
});
