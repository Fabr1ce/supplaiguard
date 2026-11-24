import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const dispatch = vi.fn(async (..._a: unknown[]) => {});
const dispatchPrivate = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/github", () => ({
  dispatch: (...a: unknown[]) => dispatch(...a),
  dispatchPrivate: (...a: unknown[]) => dispatchPrivate(...a),
  dispatchScanUrl: vi.fn(),
  scanWorkflowFile: () => "scan-repo.yml",
  findRun: vi.fn(),
  getArtifactZip: vi.fn(),
  getJobs: vi.fn(),
  getRun: vi.fn(),
  GitHubError: class extends Error {},
}));

const { default: worker } = await import("../src/index");
const { decideLaunch, emptyState, finishLaunch } = await import("../src/limits");
const { privateTarget, privateDemoId } = await import("../src/privateDemo");
const { parseLaunchRequest } = await import("../src/validate");

const ORIGIN = "https://example.test";
const reserve = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, launchId: "pg-0123456789ab" }));
const finish = vi.fn(async (..._a: unknown[]) => {});
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
    COORDINATOR: { idFromName: () => "id", get: () => ({ reserve, finish }) },
    ...over,
  }) as any;
const post = (body: unknown) =>
  new Request("https://w.test/api/launch", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const health = async (e: any) => (await (await worker.fetch(new Request("https://w.test/api/health", { headers: { origin: ORIGIN } }), e)).json()) as any;
const SET = { PRIVATE_DEMO_REPO: "acme/secret-repo-name" };

beforeEach(() => {
  dispatch.mockClear();
  dispatchPrivate.mockClear();
  reserve.mockClear();
  finish.mockClear();
});

describe("private demo: health", () => {
  it("false when absent, empty, or invalid", async () => {
    for (const v of [undefined, "", "   ", "no-slash", "a/b/c", "../x", "o/..", "o/r.git", "-o/r", "o/r name", "o/r\u0000x", "https://github.com/o/r"]) {
      expect((await health(env(v === undefined ? {} : { PRIVATE_DEMO_REPO: v }))).privateDemoAvailable).toBe(false);
    }
  });
  it("true when valid, and the response never contains the repository name", async () => {
    const h = await health(env(SET));
    expect(h.privateDemoAvailable).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/acme|secret-repo-name/);
  });
  it("false when the workflow file, ref or id is invalid", async () => {
    expect((await health(env({ ...SET, PRIVATE_DEMO_WORKFLOW_FILE: "../x.yml" }))).privateDemoAvailable).toBe(false);
    expect((await health(env({ ...SET, PRIVATE_DEMO_WORKFLOW_FILE: "x.sh" }))).privateDemoAvailable).toBe(false);
    expect((await health(env({ ...SET, PRIVATE_DEMO_REF: "a..b" }))).privateDemoAvailable).toBe(false);
    expect((await health(env({ ...SET, PRIVATE_DEMO_ID: "crypt-keeper-mcp" }))).privateDemoAvailable).toBe(false);
    expect((await health(env({ ...SET, PRIVATE_DEMO_ID: "scan-url" }))).privateDemoAvailable).toBe(false);
  });
});

describe("private demo: launch", () => {
  it("not configured: 503, nothing reserved or dispatched", async () => {
    for (const e of [env(), env({ PRIVATE_DEMO_REPO: "" }), env({ PRIVATE_DEMO_REPO: "bad" })]) {
      const res = await worker.fetch(post({ demoId: "ledgerlight" }), e);
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error.code).toBe("private_demo_unavailable");
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(dispatchPrivate).not.toHaveBeenCalled();
  });
  it("configured: reserves and dispatches to the private target, not the public workflow", async () => {
    const res = await worker.fetch(post({ demoId: "ledgerlight" }), env(SET));
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body).toEqual({ launchId: "pg-0123456789ab", demoId: "ledgerlight", proposeFix: false, status: "queued", conclusion: null });
    expect(JSON.stringify(body)).not.toMatch(/acme|secret-repo-name/);
    expect(dispatch).not.toHaveBeenCalled();
    expect(dispatchPrivate).toHaveBeenCalledWith(expect.anything(), { id: "ledgerlight", owner: "acme", repo: "secret-repo-name", workflowFile: "dependency-check.yml", ref: "main" }, "pg-0123456789ab", false);
    expect(reserve.mock.calls[0][1]).toBe("ledgerlight");
    expect(reserve.mock.calls[0][3]).toBe(false);
    expect(reserve.mock.calls[0][5]).toBe(true);
  });
  it("honours the workflow file, ref and id vars", async () => {
    await worker.fetch(post({ demoId: "other-id" }), env({ ...SET, PRIVATE_DEMO_ID: "other-id", PRIVATE_DEMO_WORKFLOW_FILE: "check.yaml", PRIVATE_DEMO_REF: "release" }));
    expect(dispatchPrivate.mock.calls[0][1]).toMatchObject({ id: "other-id", workflowFile: "check.yaml", ref: "release" });
  });
  it("proposeFix is ignored unless PRIVATE_DEMO_FIX_ENABLED is exactly \"true\" (the public flag does not count)", async () => {
    const overs: Record<string, string>[] = [{}, { PROPOSE_FIX_ENABLED: "true" }, { PRIVATE_DEMO_FIX_ENABLED: "TRUE" }, { PRIVATE_DEMO_FIX_ENABLED: "1" }, { PRIVATE_DEMO_FIX_ENABLED: "false" }];
    for (const over of overs) {
      dispatchPrivate.mockClear();
      reserve.mockClear();
      const res = await worker.fetch(post({ demoId: "ledgerlight", proposeFix: true }), env({ ...SET, ...over }));
      expect(res.status).toBe(202);
      expect(((await res.json()) as any).proposeFix, JSON.stringify(over)).toBe(false);
      expect(reserve.mock.calls[0][3]).toBe(false);
      expect(dispatchPrivate.mock.calls[0][3]).toBe(false);
    }
  });
  it("with PRIVATE_DEMO_FIX_ENABLED on, a fix request is reserved against the remediation caps and dispatched", async () => {
    const res = await worker.fetch(post({ demoId: "ledgerlight", proposeFix: true }), env({ ...SET, PRIVATE_DEMO_FIX_ENABLED: "true" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.proposeFix).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/acme|secret-repo-name/);
    expect(reserve.mock.calls[0][3]).toBe(true);
    expect(reserve.mock.calls[0][5]).toBe(true);
    expect(dispatchPrivate.mock.calls[0][3]).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("with the flag on, a launch without proposeFix stays a plain scan", async () => {
    await worker.fetch(post({ demoId: "ledgerlight" }), env({ ...SET, PRIVATE_DEMO_FIX_ENABLED: "true" }));
    expect(dispatchPrivate.mock.calls[0][3]).toBe(false);
  });
  it("health reports privateDemoFixEnabled only when the flag is on AND the demo is connected", async () => {
    expect((await health(env(SET))).privateDemoFixEnabled).toBe(false);
    expect((await health(env({ PRIVATE_DEMO_FIX_ENABLED: "true" }))).privateDemoFixEnabled).toBe(false);
    expect((await health(env({ ...SET, PRIVATE_DEMO_FIX_ENABLED: "true" }))).privateDemoFixEnabled).toBe(true);
  });
  it("a non-boolean proposeFix is still a 400", async () => {
    expect((await worker.fetch(post({ demoId: "ledgerlight", proposeFix: "true" }), env(SET))).status).toBe(400);
    expect(dispatchPrivate).not.toHaveBeenCalled();
  });
  it("unknown ids and extra fields stay rejected", async () => {
    for (const b of [{ demoId: "Ledgerlight" }, { demoId: "ledgerlight2" }, { demoId: "ledgerlight", repo: "x/y" }, { demoId: "ledgerlight", inputs: {} }]) {
      expect((await worker.fetch(post(b), env(SET))).status).toBe(400);
    }
    expect(dispatchPrivate).not.toHaveBeenCalled();
  });
  it("the id is only accepted when the Worker passes it from its own config", () => {
    expect(parseLaunchRequest({ demoId: "ledgerlight" })).toMatchObject({ ok: false });
    expect(parseLaunchRequest({ demoId: "ledgerlight" }, { privateDemoId: null })).toMatchObject({ ok: false });
    expect(parseLaunchRequest({ demoId: "ledgerlight" }, { privateDemoId: "ledgerlight" })).toEqual({ ok: true, privateDemo: "ledgerlight", proposeFix: false });
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp" }, { privateDemoId: "ledgerlight" })).toMatchObject({ ok: true, demoId: "crypt-keeper-mcp" });
  });
  it("limit replies are 429 with their own codes", async () => {
    for (const reason of ["private_rate_limited", "private_daily_cap", "busy"]) {
      reserve.mockResolvedValueOnce({ ok: false, reason, retryAfterSec: 5 } as any);
      const res = await worker.fetch(post({ demoId: "ledgerlight" }), env(SET));
      expect(res.status).toBe(429);
      expect(((await res.json()) as any).error.code).toBe(reason);
    }
    expect(dispatchPrivate).not.toHaveBeenCalled();
  });
  it("a failed dispatch refunds the reservation and returns a generic 502", async () => {
    dispatchPrivate.mockRejectedValueOnce(new Error("dispatch 404 acme/secret-repo-name"));
    const res = await worker.fetch(post({ demoId: "ledgerlight" }), env(SET));
    expect(res.status).toBe(502);
    expect(finish).toHaveBeenCalledWith("pg-0123456789ab", true);
    expect(JSON.stringify(await res.json())).not.toMatch(/acme|secret-repo-name/);
  });
  it("passes the cap vars (defaults 6 per day, 2 per client) to the coordinator", async () => {
    await worker.fetch(post({ demoId: "ledgerlight" }), env(SET));
    expect(reserve.mock.calls[0][2]).toMatchObject({ privateDemoDailyCap: 6, privateDemoPerClientPerDay: 2 });
    await worker.fetch(post({ demoId: "ledgerlight" }), env({ ...SET, PRIVATE_DEMO_DAILY_CAP: "9", PRIVATE_DEMO_PER_CLIENT_PER_DAY: "4" }));
    expect(reserve.mock.calls[1][2]).toMatchObject({ privateDemoDailyCap: 9, privateDemoPerClientPerDay: 4 });
  });
});

describe("private demo: config parsing", () => {
  it("defaults", () => {
    expect(privateTarget({ PRIVATE_DEMO_REPO: "a/b" })).toEqual({ id: "ledgerlight", owner: "a", repo: "b", workflowFile: "dependency-check.yml", ref: "main" });
    expect(privateDemoId({})).toBe("ledgerlight");
  });
});

describe("private demo: limits", () => {
  const cfg = { enabled: true, dailyCap: 30, perClientPerHour: 5, activeTtlMs: 0, retainMs: 1e12, proposeFixDailyCap: 3, proposeFixPerClientPerDay: 1, privateDemoDailyCap: 3, privateDemoPerClientPerDay: 2 };
  const T = Date.UTC(2026, 10, 20, 12);
  const P = (id: string, t: number, priv = true) => ({ id, demo: priv ? "ledgerlight" : "crypt-keeper-mcp", createdAt: t, ...(priv ? { privateDemo: true } : {}) });
  const ok = (d: any) => {
    if (!d.ok) throw new Error(d.reason);
    return d.state;
  };
  it("per client per day, other demos unaffected", () => {
    let s = ok(decideLaunch(emptyState(), T, "c", P("p1", T), cfg));
    s = ok(decideLaunch(s, T + 10, "c", P("p2", T + 10), cfg));
    expect(decideLaunch(s, T + 20, "c", P("p3", T + 20), cfg)).toMatchObject({ ok: false, reason: "private_rate_limited" });
    expect(decideLaunch(s, T + 20, "c", P("p4", T + 20, false), cfg).ok).toBe(true);
    expect(decideLaunch(s, T + 25 * 3_600_000, "c", P("p5", T + 25 * 3_600_000), cfg).ok).toBe(true);
  });
  it("global daily cap", () => {
    let s = emptyState();
    for (const c of ["a", "b", "c"]) s = ok(decideLaunch(s, T, c, P("p" + c, T), cfg));
    expect(decideLaunch(s, T + 10, "z", P("pz", T + 10), cfg)).toMatchObject({ ok: false, reason: "private_daily_cap" });
  });
  it("defaults to 6 per day and 2 per client when the config omits the caps", () => {
    const { privateDemoDailyCap: _a, privateDemoPerClientPerDay: _b, ...bare } = cfg;
    let s = emptyState();
    s = ok(decideLaunch(s, T, "c", P("p1", T), bare));
    s = ok(decideLaunch(s, T + 1, "c", P("p2", T + 1), bare));
    expect(decideLaunch(s, T + 2, "c", P("p3", T + 2), bare)).toMatchObject({ reason: "private_rate_limited" });
    for (const c of ["d", "e", "f", "g"]) s = ok(decideLaunch(s, T + 3, c, P("p" + c, T + 3), bare));
    expect(decideLaunch(s, T + 4, "h", P("ph", T + 4), bare)).toMatchObject({ reason: "private_daily_cap" });
  });
  it("global limits still apply: one active run, hourly limit", () => {
    const s = ok(decideLaunch(emptyState(), T, "c", P("p1", T), cfg));
    expect(decideLaunch(s, T + 1, "d", P("p2", T + 1), { ...cfg, activeTtlMs: 60_000 })).toMatchObject({ reason: "busy" });
    expect(decideLaunch(s, T + 1, "c", P("p3", T + 1), { ...cfg, perClientPerHour: 1 })).toMatchObject({ reason: "rate_limited" });
  });
  it("a refund gives back the client's launch and the daily count", () => {
    let s = ok(decideLaunch(emptyState(), T, "c", P("p1", T), cfg));
    s = finishLaunch(s, "p1", true);
    expect(s.privDaily?.["2026-11-20"]).toBe(0);
    s = ok(decideLaunch(s, T + 5, "c", P("p2", T + 5), cfg));
    s = ok(decideLaunch(s, T + 6, "c", P("p3", T + 6), cfg));
    expect(decideLaunch(s, T + 7, "c", P("p4", T + 7), cfg)).toMatchObject({ reason: "private_rate_limited" });
  });
  it("loads state saved before the private demo existed", () => {
    expect(decideLaunch({ launches: {}, active: null, daily: {}, clients: {} }, T, "c", P("p1", T), cfg).ok).toBe(true);
  });
});
