import { describe, expect, it } from "vitest";
import { describeFix } from "./fix";

const gate = { ran: true, changed: ["package.json"], major: [], added: [] };

describe("describeFix", () => {
  it("a draft PR is described as needing review, never as merged", () => {
    const v = describeFix({ available: true, prUrl: "https://github.com/o/r/pull/1", gate, recheck: { outcome: "improved", complete: true, cleared: 2, remaining: 1 } });
    expect(v.tone).toBe("ok");
    expect(v.headline).toMatch(/draft/i);
    expect(v.headline).toMatch(/nothing merges automatically/i);
    expect(v.lines.join(" ")).toMatch(/2 cleared, 1 still open/);
    expect(v.lines.join(" ")).toMatch(/Tests were not run/);
  });
  it("flags high-impact changes", () => {
    const v = describeFix({ available: true, prUrl: null, gate: { ran: true, changed: ["package.json"], major: ["x: 1.0.0 -> 2.0.0"], added: ["y@1.0.0"] } });
    expect(v.lines.join(" ")).toMatch(/major.*x: 1.0.0 -> 2.0.0/);
    expect(v.lines.join(" ")).toMatch(/new dependency.*y@1.0.0/);
  });
  it("no PR without claiming success", () => {
    expect(describeFix({ available: true, prUrl: null, gate }).tone).toBe("none");
    expect(describeFix({ available: true, prUrl: null, gate: { ran: false, changed: [], major: [], added: [] } }).tone).toBe("blocked");
  });
  it("says so when the artifact is gone", () => {
    expect(describeFix({ available: false, prUrl: null }).tone).toBe("unknown");
  });
  it("notes an incomplete re-scan", () => {
    const v = describeFix({ available: true, prUrl: null, gate, recheck: { outcome: "unchanged", complete: false, cleared: 0, remaining: 3 } });
    expect(v.lines.join(" ")).toMatch(/did not complete/);
  });
});
