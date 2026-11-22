import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const dispatch = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/github", () => ({
  dispatch: (...a: unknown[]) => dispatch(...a),
  findRun: vi.fn(),
  getArtifactZip: vi.fn(),
  getJobs: vi.fn(),
  getRun: vi.fn(),
  GitHubError: class extends Error {},
}));

const { default: worker } = await import("../src/index");
const { decideLaunch, emptyState } = await import("../src/limits");

const ORIGIN = "https://example.test";
const reserve = vi.fn(async (_c: string, _d: string, _cfg: unknown, _fix?: boolean) => ({ ok: true as const, launchId: "pg-0123456789ab" }));
const env = (over: Record<string, string> = {}) =>
  ({
    ALLOWED_ORIGIN: ORIGIN,
    GITHUB_OWNER: "o",
    GITHUB_REPO: "r",
    WORKFLOW_FILE: "demo-triage.yml",
    WORKFLOW_REF: "main",
    LAUNCH_ENABLED: "true",
    DAILY_CAP: "30",
    PER_CLIENT_LAUNCHES_PER_HOUR: "3",
    COORDINATOR: { idFromName: () => "id", get: () => ({ reserve, finish: vi.fn() }) },
    ...over,
  }) as any;
const post = (body: unknown) =>
  new Request("https://w.test/api/launch", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });

beforeEach(() => {
  dispatch.mockClear();
  reserve.mockClear();
});

describe("health", () => {
  it("reports proposeFixEnabled, false unless the setting is exactly 'true'", async () => {
    const h = async (e: any) => (await (await worker.fetch(new Request("https://w.test/api/health", { headers: { origin: ORIGIN } }), e)).json()) as any;
    expect((await h(env())).proposeFixEnabled).toBe(false);
    expect((await h(env({ PROPOSE_FIX_ENABLED: "false" }))).proposeFixEnabled).toBe(false);
    expect((await h(env({ PROPOSE_FIX_ENABLED: "TRUE" }))).proposeFixEnabled).toBe(false);
    expect((await h(env({ PROPOSE_FIX_ENABLED: "true" }))).proposeFixEnabled).toBe(true);
  });
});

describe("POST /api/launch and the propose-fix flag", () => {
  it("setting off: a request for remediation is ignored", async () => {
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: true }), env({ PROPOSE_FIX_ENABLED: "false" }));
    expect(res.status).toBe(202);
    expect(((await res.json()) as any).proposeFix).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), "crypt-keeper-mcp", "pg-0123456789ab", false);
    expect(reserve.mock.calls[0][3]).toBe(false);
  });
  it("setting unset: also off", async () => {
    await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: true }), env());
    expect(dispatch.mock.calls[0][3]).toBe(false);
  });
  it("setting on and requested: forwarded to the dispatch and counted", async () => {
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: true }), env({ PROPOSE_FIX_ENABLED: "true" }));
    expect(((await res.json()) as any).proposeFix).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), "crypt-keeper-mcp", "pg-0123456789ab", true);
    expect(reserve.mock.calls[0][3]).toBe(true);
  });
  it("setting on but not requested: not forwarded", async () => {
    await worker.fetch(post({ demoId: "crypt-keeper-mcp" }), env({ PROPOSE_FIX_ENABLED: "true" }));
    expect(dispatch.mock.calls[0][3]).toBe(false);
  });
  it.each(["true", 1, null])("rejects proposeFix = %j with 400 and dispatches nothing", async (v) => {
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: v }), env({ PROPOSE_FIX_ENABLED: "true" }));
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects unknown fields even when the setting is on", async () => {
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: true, inputs: { x: 1 } }), env({ PROPOSE_FIX_ENABLED: "true" }));
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("a fix limit reply is a 429 with its own message", async () => {
    reserve.mockResolvedValueOnce({ ok: false, reason: "fix_rate_limited" } as any);
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp", proposeFix: true }), env({ PROPOSE_FIX_ENABLED: "true" }));
    expect(res.status).toBe(429);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("propose-fix limits are tighter than normal launches", () => {
  const cfg = { enabled: true, dailyCap: 30, perClientPerHour: 3, activeTtlMs: 1000, retainMs: 1e12, proposeFixDailyCap: 2, proposeFixPerClientPerDay: 1 };
  const T = Date.UTC(2026, 10, 20, 12);
  const L = (id: string, t: number, fix: boolean) => ({ id, demo: "crypt-keeper-mcp", createdAt: t, ...(fix ? { proposeFix: true } : {}) });
  it("one remediation per client per day, normal scans unaffected", () => {
    const a = decideLaunch(emptyState(), T, "c", L("p1", T, true), cfg);
    if (!a.ok) throw new Error();
    expect(decideLaunch(a.state, T + 5000, "c", L("p2", T + 5000, true), cfg)).toMatchObject({ ok: false, reason: "fix_rate_limited" });
    expect(decideLaunch(a.state, T + 5000, "c", L("p3", T + 5000, false), cfg).ok).toBe(true);
    expect(decideLaunch(a.state, T + 25 * 3_600_000, "c", L("p4", T + 25 * 3_600_000, true), cfg).ok).toBe(true);
  });
  it("a global daily cap for remediation", () => {
    let s = emptyState();
    for (const c of ["a", "b"]) {
      const d = decideLaunch(s, T, c, L("p" + c, T, true), { ...cfg, activeTtlMs: 0 });
      if (!d.ok) throw new Error(d.reason);
      s = d.state;
    }
    expect(decideLaunch(s, T + 10, "z", L("pz", T + 10, true), { ...cfg, activeTtlMs: 0 })).toMatchObject({ ok: false, reason: "fix_daily_cap" });
  });
  it("loads state saved before the flag existed", () => {
    expect(decideLaunch({ launches: {}, active: null, daily: {}, clients: {} }, T, "c", L("p1", T, true), cfg).ok).toBe(true);
  });
});
