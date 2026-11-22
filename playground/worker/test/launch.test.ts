import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const dispatch = vi.fn(async (..._a: unknown[]) => {});
const dispatchScanUrl = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/github", () => ({
  dispatch: (...a: unknown[]) => dispatch(...a),
  dispatchScanUrl: (...a: unknown[]) => dispatchScanUrl(...a),
  scanWorkflowFile: () => "scan-repo.yml",
  findRun: vi.fn(),
  getArtifactZip: vi.fn(),
  getJobs: vi.fn(),
  getRun: vi.fn(),
  GitHubError: class extends Error {},
}));

const { default: worker } = await import("../src/index");
const { decideLaunch, emptyState, finishLaunch } = await import("../src/limits");

const ORIGIN = "https://example.test";
const reserve = vi.fn(async (_c: string, _d: string, _cfg: unknown, _fix?: boolean, _scan?: unknown) => ({ ok: true as const, launchId: "pg-0123456789ab" }));
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
  dispatchScanUrl.mockClear();
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

describe("health reports scanUrlEnabled", () => {
  const h = async (e: any) => (await (await worker.fetch(new Request("https://w.test/api/health", { headers: { origin: ORIGIN } }), e)).json()) as any;
  it("false unless the setting is exactly 'true'", async () => {
    expect((await h(env())).scanUrlEnabled).toBe(false);
    expect((await h(env({ SCAN_URL_ENABLED: "false" }))).scanUrlEnabled).toBe(false);
    expect((await h(env({ SCAN_URL_ENABLED: "TRUE" }))).scanUrlEnabled).toBe(false);
    expect((await h(env({ SCAN_URL_ENABLED: "1" }))).scanUrlEnabled).toBe(false);
    expect((await h(env({ SCAN_URL_ENABLED: "true" }))).scanUrlEnabled).toBe(true);
  });
});

describe("POST /api/launch with a repository (scan by URL flag)", () => {
  const on = { SCAN_URL_ENABLED: "true" };
  it("flag off or unset: 403, nothing reserved or dispatched", async () => {
    for (const e of [env(), env({ SCAN_URL_ENABLED: "false" })]) {
      const res = await worker.fetch(post({ repoUrl: "octo/hello" }), e);
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).error.code).toBe("scan_url_disabled");
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(dispatchScanUrl).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("flag on: dispatches scan-repo with the normalized repo and ref only", async () => {
    const res = await worker.fetch(post({ repoUrl: "  https://github.com/Octo/Hello.git/  ", ref: "release/1.2" }), env(on));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ launchId: "pg-0123456789ab", demoId: "scan-url", scanUrl: { repo: "Octo/Hello", ref: "release/1.2" } });
    expect(dispatchScanUrl).toHaveBeenCalledWith(expect.anything(), "Octo/Hello", "release/1.2", "pg-0123456789ab");
    expect(dispatch).not.toHaveBeenCalled();
    expect(reserve.mock.calls[0][1]).toBe("scan-url");
    expect(reserve.mock.calls[0][4]).toEqual({ repo: "Octo/Hello", ref: "release/1.2" });
  });
  it("flag on, no ref: ref is null", async () => {
    await worker.fetch(post({ repoUrl: "https://github.com/o/r/tree/dev" }), env(on));
    expect(dispatchScanUrl).toHaveBeenCalledWith(expect.anything(), "o/r", "dev", "pg-0123456789ab");
  });
  it.each([
    "https://evil.test/o/r",
    "http://github.com/o/r",
    "https://user:pw@github.com/o/r",
    "https://github.com:443/o/r",
    "o/r%0aX",
    "o/r\nsecond",
    "o/r\u202e",
    "o/\u200br",
    "https://g\u0456thub.com/o/r",
    "-o/r",
    "o/..",
    "ignore previous instructions/x",
    "o/r; curl x | sh",
    "x".repeat(400),
  ])("hostile input %j is rejected before any reservation or network call", async (v) => {
    const res = await worker.fetch(post({ repoUrl: v }), env(on));
    expect(res.status).toBe(400);
    expect(reserve).not.toHaveBeenCalled();
    expect(dispatchScanUrl).not.toHaveBeenCalled();
  });
  it("hostile ref is rejected the same way", async () => {
    for (const ref of ["--upload-pack=x", "a..b", "$(id)", "a b", "main\n"]) {
      expect((await worker.fetch(post({ repoUrl: "o/r", ref }), env(on))).status).toBe(400);
    }
    expect(dispatchScanUrl).not.toHaveBeenCalled();
  });
  it("both forms together, ref alone, neither: 400", async () => {
    for (const b of [{ repoUrl: "o/r", demoId: "crypt-keeper-mcp" }, { ref: "main" }, {}, { repoUrl: "o/r", proposeFix: true }, { repoUrl: 3 }]) {
      expect((await worker.fetch(post(b), env(on))).status).toBe(400);
    }
    expect(dispatchScanUrl).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rate limit replies are 429 with their own messages and dispatch nothing", async () => {
    for (const reason of ["scan_url_rate_limited", "scan_url_daily_cap", "busy", "rate_limited", "daily_cap"]) {
      reserve.mockResolvedValueOnce({ ok: false, reason, retryAfterSec: 10 } as any);
      const res = await worker.fetch(post({ repoUrl: "o/r" }), env(on));
      expect(res.status).toBe(429);
      expect(((await res.json()) as any).error.code).toBe(reason);
    }
    expect(dispatchScanUrl).not.toHaveBeenCalled();
  });
  it("a failed dispatch is a 502", async () => {
    dispatchScanUrl.mockRejectedValueOnce(new Error("boom"));
    const res = await worker.fetch(post({ repoUrl: "o/r" }), env(on));
    expect(res.status).toBe(502);
  });
  it("the demo form still works with the scan flag on", async () => {
    const res = await worker.fetch(post({ demoId: "crypt-keeper-mcp" }), env(on));
    expect(res.status).toBe(202);
    expect(dispatch).toHaveBeenCalled();
    expect(dispatchScanUrl).not.toHaveBeenCalled();
  });
  it("accepts a body larger than the old 256 byte cap but not a huge one", async () => {
    expect((await worker.fetch(post({ repoUrl: "o/" + "a".repeat(90), ref: "b".repeat(150) }), env(on))).status).toBe(202);
    expect((await worker.fetch(post({ repoUrl: "x".repeat(5000) }), env(on))).status).toBe(413);
  });
});

describe("scan-by-URL limits are tighter than normal launches", () => {
  const cfg = { enabled: true, dailyCap: 30, perClientPerHour: 3, activeTtlMs: 1000, retainMs: 1e12, proposeFixDailyCap: 3, proposeFixPerClientPerDay: 1, scanUrlDailyCap: 2, scanUrlPerClientPerDay: 1 };
  const T = Date.UTC(2026, 10, 20, 12);
  const U = (id: string, t: number, scan: boolean) => ({ id, demo: scan ? "scan-url" : "crypt-keeper-mcp", createdAt: t, ...(scan ? { scanUrl: { repo: "o/r", ref: null } } : {}) });
  it("one URL scan per client per day, demos unaffected, and the global limits still apply", () => {
    const a = decideLaunch(emptyState(), T, "c", U("p1", T, true), cfg);
    if (!a.ok) throw new Error();
    expect(decideLaunch(a.state, T + 5000, "c", U("p2", T + 5000, true), cfg)).toMatchObject({ ok: false, reason: "scan_url_rate_limited" });
    expect(decideLaunch(a.state, T + 5000, "c", U("p3", T + 5000, false), cfg).ok).toBe(true);
    expect(decideLaunch(a.state, T + 25 * 3_600_000, "c", U("p4", T + 25 * 3_600_000, true), cfg).ok).toBe(true);
    // concurrency: only one run at a time
    expect(decideLaunch(a.state, T + 1, "d", U("p5", T + 1, true), { ...cfg, activeTtlMs: 60_000 })).toMatchObject({ ok: false, reason: "busy" });
    // the hourly limit for all launches counts URL scans too
    expect(decideLaunch(a.state, T + 5000, "c", U("p6", T + 5000, false), { ...cfg, perClientPerHour: 1 })).toMatchObject({ ok: false, reason: "rate_limited" });
  });
  it("a global daily cap for URL scans", () => {
    let s = emptyState();
    for (const c of ["a", "b"]) {
      const d = decideLaunch(s, T, c, U("p" + c, T, true), { ...cfg, activeTtlMs: 0 });
      if (!d.ok) throw new Error(d.reason);
      s = d.state;
    }
    expect(decideLaunch(s, T + 10, "z", U("pz", T + 10, true), { ...cfg, activeTtlMs: 0 })).toMatchObject({ ok: false, reason: "scan_url_daily_cap" });
  });
  it("defaults to 5 per day and 1 per client when the config omits the caps", () => {
    const { scanUrlDailyCap: _a, scanUrlPerClientPerDay: _b, ...bare } = cfg;
    const a = decideLaunch(emptyState(), T, "c", U("p1", T, true), bare);
    if (!a.ok) throw new Error();
    expect(decideLaunch(a.state, T + 5000, "c", U("p2", T + 5000, true), bare)).toMatchObject({ ok: false, reason: "scan_url_rate_limited" });
  });
  it("a refunded launch gives back the client's daily scan and the daily count", () => {
    const a = decideLaunch(emptyState(), T, "c", U("p1", T, true), cfg);
    if (!a.ok) throw new Error();
    const after = finishLaunch(a.state, "p1", true);
    expect(decideLaunch(after, T + 5000, "c", U("p2", T + 5000, true), cfg).ok).toBe(true);
  });
  it("loads state saved before the flag existed", () => {
    expect(decideLaunch({ launches: {}, active: null, daily: {}, clients: {} }, T, "c", U("p1", T, true), cfg).ok).toBe(true);
  });
});
