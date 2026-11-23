import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const load = async () => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
  return import("./api");
};

describe("launch request body", () => {
  it("omits proposeFix unless it is true", async () => {
    const { launchBody } = await load();
    expect(JSON.parse(launchBody("crypt-keeper-mcp"))).toEqual({ demoId: "crypt-keeper-mcp" });
    expect(JSON.parse(launchBody("crypt-keeper-mcp", false))).toEqual({ demoId: "crypt-keeper-mcp" });
    expect(JSON.parse(launchBody("crypt-keeper-mcp", true))).toEqual({ demoId: "crypt-keeper-mcp", proposeFix: true });
  });
  it("launchDemo posts that body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ launchId: "pg-0123456789ab" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { launchDemo } = await load();
    await launchDemo("seance-gateway", true);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ demoId: "seance-gateway", proposeFix: true });
    await launchDemo("seance-gateway");
    expect(JSON.parse(((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]).body as string)).toEqual({ demoId: "seance-gateway" });
  });
});

describe("health and the toggle", () => {
  it("shows the toggle only when the service reports it, and launching is on", async () => {
    const { canProposeFix } = await load();
    expect(canProposeFix(null)).toBe(false);
    expect(canProposeFix({ ok: true, launchEnabled: true })).toBe(false); // older Worker
    expect(canProposeFix({ ok: true, launchEnabled: true, proposeFixEnabled: false })).toBe(false);
    expect(canProposeFix({ ok: true, launchEnabled: false, proposeFixEnabled: true })).toBe(false);
    expect(canProposeFix({ ok: true, launchEnabled: true, proposeFixEnabled: true })).toBe(true);
  });
  it("getHealth reads proposeFixEnabled from the Worker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, launchEnabled: true, proposeFixEnabled: true }))));
    const { getHealth } = await load();
    expect((await getHealth()).proposeFixEnabled).toBe(true);
  });
});

describe("scan by URL", () => {
  it("canScanUrl is true only when the service reports it and launching is on", async () => {
    const { canScanUrl } = await load();
    expect(canScanUrl(null)).toBe(false);
    expect(canScanUrl({ ok: true, launchEnabled: true })).toBe(false); // older Worker
    expect(canScanUrl({ ok: true, launchEnabled: true, scanUrlEnabled: false })).toBe(false);
    expect(canScanUrl({ ok: true, launchEnabled: false, scanUrlEnabled: true })).toBe(false);
    expect(canScanUrl({ ok: true, launchEnabled: true, scanUrlEnabled: true })).toBe(true);
  });
  it("sends only repoUrl, plus ref when given, and never a demo field", async () => {
    const { launchUrlBody } = await load();
    expect(JSON.parse(launchUrlBody("o/r"))).toEqual({ repoUrl: "o/r" });
    expect(JSON.parse(launchUrlBody("o/r", ""))).toEqual({ repoUrl: "o/r" });
    expect(JSON.parse(launchUrlBody("o/r", null))).toEqual({ repoUrl: "o/r" });
    expect(JSON.parse(launchUrlBody("o/r", "v1"))).toEqual({ repoUrl: "o/r", ref: "v1" });
  });
  it("launchRepo posts it and surfaces the Worker's error and retry-after", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "scan_url_rate_limited", message: "used today" } }), { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { launchRepo } = await load();
    await expect(launchRepo("o/r", "main")).rejects.toMatchObject({ code: "scan_url_rate_limited", status: 429, retryAfter: 120 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ repoUrl: "o/r", ref: "main" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "scan_url_disabled", message: "off" } }), { status: 403 }));
    await expect(launchRepo("o/r")).rejects.toMatchObject({ code: "scan_url_disabled", status: 403 });
  });
});
