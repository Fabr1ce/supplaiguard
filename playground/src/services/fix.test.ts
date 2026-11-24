import { describe, expect, it } from "vitest";
import { describeFix, describePrivateFix } from "./fix";

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

describe("describePrivateFix", () => {
  const base = { available: true, prUrl: null, gate: { ran: true, changedCount: 2, majorCount: 1, addedCount: 0 }, recheck: { outcome: "fixed" as const, complete: true, cleared: 3, remaining: 1, clearedByRule: { "MCP-001": 2, "AGT-003": 1 } } };
  it("a PR: ok, with counts and rule ids, and says tests were not run", () => {
    const v = describePrivateFix({ ...base, prUrl: "https://github.com/a/b/pull/1" });
    expect(v.tone).toBe("ok");
    expect(v.headline).toMatch(/draft pull request/i);
    expect(v.lines.join(" ")).toMatch(/2 changed files/);
    expect(v.lines.join(" ")).toMatch(/1 major or unparseable version change needs explicit approval/);
    expect(v.lines.join(" ")).toMatch(/MCP-001 x2, AGT-003 x1/);
    expect(v.lines.join(" ")).toMatch(/Tests were not run/);
  });
  it("unverified re-scan never reads as fixed", () => {
    const v = describePrivateFix({ ...base, recheck: { ...base.recheck, outcome: "unverified", complete: false } });
    expect(v.lines.join(" ")).toMatch(/nothing is confirmed as fixed/);
  });
  it("missing artifact: unknown, and says nothing was confirmed", () => {
    const v = describePrivateFix({ available: false, prUrl: null, gate: { ran: false, changedCount: 0, majorCount: 0, addedCount: 0 }, recheck: null });
    expect(v.tone).toBe("unknown");
    expect(v.lines.join(" ")).toMatch(/Nothing here says the findings were fixed/);
  });
  it("gate did not run: blocked; gate ran without a PR: none", () => {
    expect(describePrivateFix({ ...base, gate: { ...base.gate, ran: false }, recheck: null }).tone).toBe("blocked");
    expect(describePrivateFix(base).tone).toBe("none");
  });
});
