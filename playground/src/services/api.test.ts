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
