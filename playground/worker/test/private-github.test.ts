import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPrivate, findRun, getArtifactZip } from "../src/github";

const target = { id: "ledgerlight", owner: "acme", repo: "private-one", workflowFile: "dependency-check.yml", ref: "main" };

async function pem() {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  let s = "";
  for (const c of der) s += String.fromCharCode(c);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`;
}

type Call = { url: string; method: string; body: any; auth: string };
function mockFetch(calls: Call[], dispatchStatus = 204) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null, auth: h.authorization });
      if (url.endsWith("/installation")) return new Response(JSON.stringify({ id: 77 }));
      if (url.endsWith("/access_tokens")) return new Response(JSON.stringify({ token: "ghs_TESTTOKEN", expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
      if (url.includes("/dispatches")) return new Response(null, { status: dispatchStatus });
      if (url.includes("/artifacts?name=")) return new Response(JSON.stringify({ artifacts: [] }));
      if (url.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 5, name: "pg-0123456789ab", status: "queued", conclusion: null, html_url: "u", created_at: "", updated_at: "", head_branch: "main", head_sha: "x" }] }));
      return new Response("{}", { status: 404 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("private target GitHub calls", async () => {
  const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: await pem(), GITHUB_OWNER: "o", GITHUB_REPO: "pub", WORKFLOW_FILE: "demo-triage.yml", WORKFLOW_REF: "main" } as any;

  it("dispatch sends only launch_id, to the private repo, on its ref, with a token scoped to that repo", async () => {
    const calls: Call[] = [];
    mockFetch(calls);
    await dispatchPrivate(env, target, "pg-0123456789ab");
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/private-one/installation");
    const tok = calls.find((c) => c.url.endsWith("/access_tokens"))!;
    expect(tok.body).toEqual({ repositories: ["private-one"], permissions: { actions: "write" } });
    const d = calls.find((c) => c.url.includes("/dispatches"))!;
    expect(d.url).toBe("https://api.github.com/repos/acme/private-one/actions/workflows/dependency-check.yml/dispatches");
    expect(d.body).toEqual({ ref: "main", inputs: { launch_id: "pg-0123456789ab" } });
    expect(d.auth).toBe("Bearer ghs_TESTTOKEN");
    expect(calls.every((c) => !c.url.includes("/o/pub"))).toBe(true);
  });
  it("a non-204 dispatch is an error", async () => {
    mockFetch([], 422);
    await expect(dispatchPrivate(env, { ...target, repo: "private-two" }, "pg-0123456789ab")).rejects.toThrow("dispatch 422");
  });
  it("run lookup and artifact calls go to the private repo", async () => {
    const calls: Call[] = [];
    mockFetch(calls);
    const run = await findRun(env, "pg-0123456789ab", Date.now(), target.workflowFile, { ...target, repo: "private-three" });
    expect(run?.id).toBe(5);
    await getArtifactZip(env, 5, "supplaiguard-report", { ...target, repo: "private-three" });
    const api = calls.filter((c) => c.url.includes("/actions/"));
    expect(api.length).toBe(2);
    for (const c of api) expect(c.url).toContain("/repos/acme/private-three/");
  });
  it("tokens are never written to the console", async () => {
    const spy = vi.spyOn(console, "log");
    const spyE = vi.spyOn(console, "error");
    mockFetch([]);
    await dispatchPrivate(env, { ...target, repo: "private-four" }, "pg-0123456789ab");
    for (const s of [spy, spyE]) expect(JSON.stringify(s.mock.calls)).not.toContain("ghs_TESTTOKEN");
  });
});
