import { describe, expect, it } from "vitest";
import { currentFlavor } from "./flavor";
import { simulateExecution } from "./simulate";

const at = (s: number, end = "success", fix = false) => {
  const e = simulateExecution(s, end, fix);
  return { e, f: currentFlavor(e.status, e.conclusion, e.jobs) };
};

describe("simulateExecution", () => {
  it("walks queued, scan, copy, triage, publish, success", () => {
    expect(at(1).f.key).toBe("queued");
    expect(at(8 + 12 + 1).f.key).toBe("scan");
    expect(at(8 + 8 * 2.5 + 1).f.key).toBe("copy");
    expect(at(8 + 8 * 5.5 + 1).f.key).toBe("triage");
    expect(at(8 + 8 * 8.5 + 1, "success", false).f.key).toBe("publish");
    expect(at(500).f).toEqual({ key: "run", status: "success" });
  });
  it("ends in failure or cancel when asked", () => {
    expect(at(500, "failure").f).toEqual({ key: "run", status: "failure" });
    expect(at(500, "cancelled").f).toEqual({ key: "run", status: "cancelled" });
  });
});
