import { describe, expect, it } from "vitest";
import { decideLaunch, emptyState, finishLaunch, type LimitConfig } from "../src/limits";
import { isDemoId, LAUNCH_ID_RE } from "../src/demos";

const cfg: LimitConfig = { enabled: true, dailyCap: 3, perClientPerHour: 2, activeTtlMs: 600_000, retainMs: 1e9 };
const L = (id: string, t: number) => ({ id, demo: "crypt-keeper-mcp", createdAt: t });
const T = Date.UTC(2026, 10, 20, 12);

describe("demo allowlist", () => {
  it("accepts the four demos only", () => {
    for (const d of ["vulnerable-ai-app", "haunted-storyteller", "crypt-keeper-mcp", "seance-gateway"]) expect(isDemoId(d)).toBe(true);
    for (const d of ["all", "__proto__", "constructor", "../x", "", 1, null, undefined]) expect(isDemoId(d)).toBe(false);
  });
  it("launch ids have a fixed shape", () => {
    expect(LAUNCH_ID_RE.test("pg-0123456789ab")).toBe(true);
    expect(LAUNCH_ID_RE.test("pg-0123456789abc")).toBe(false);
    expect(LAUNCH_ID_RE.test("1234")).toBe(false);
  });
});

describe("decideLaunch", () => {
  it("blocks when disabled", () => {
    expect(decideLaunch(emptyState(), T, "a", L("p1", T), { ...cfg, enabled: false })).toMatchObject({ ok: false, reason: "disabled" });
  });
  it("allows one active launch at a time, then frees the slot", () => {
    const a = decideLaunch(emptyState(), T, "a", L("p1", T), cfg);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(decideLaunch(a.state, T + 1000, "b", L("p2", T + 1000), cfg)).toMatchObject({ ok: false, reason: "busy" });
    const freed = finishLaunch(a.state, "p1");
    expect(decideLaunch(freed, T + 2000, "b", L("p2", T + 2000), cfg).ok).toBe(true);
  });
  it("treats an old active launch as finished", () => {
    const a = decideLaunch(emptyState(), T, "a", L("p1", T), cfg);
    if (!a.ok) throw new Error();
    expect(decideLaunch(a.state, T + 700_000, "b", L("p2", T + 700_000), cfg).ok).toBe(true);
  });
  it("rate limits one client per hour", () => {
    let s = emptyState();
    for (let i = 0; i < 2; i++) {
      const d = decideLaunch(s, T + i * 10, "a", L("p" + i, T + i * 10), cfg);
      if (!d.ok) throw new Error("unexpected " + d.reason);
      s = finishLaunch(d.state, "p" + i);
    }
    expect(decideLaunch(s, T + 100, "a", L("p9", T + 100), cfg)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(decideLaunch(s, T + 100, "b", L("p9", T + 100), cfg).ok).toBe(true);
  });
  it("enforces the daily cap, and a refund gives the launch back", () => {
    let s = emptyState();
    for (let i = 0; i < 3; i++) {
      const d = decideLaunch(s, T + i, "c" + i, L("p" + i, T + i), cfg);
      if (!d.ok) throw new Error("unexpected " + d.reason);
      s = finishLaunch(d.state, "p" + i);
    }
    expect(decideLaunch(s, T + 10, "z", L("p9", T + 10), cfg)).toMatchObject({ ok: false, reason: "daily_cap" });
    s = finishLaunch(s, "p2", true);
    expect(decideLaunch(s, T + 10, "z", L("p9", T + 10), cfg).ok).toBe(true);
  });
});
