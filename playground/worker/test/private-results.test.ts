import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const getRun = vi.fn();
const findRun = vi.fn();
const getJobs = vi.fn(async (..._a: unknown[]) => []);
const getArtifactZip = vi.fn();
vi.mock("../src/github", () => ({
  dispatch: vi.fn(),
  dispatchPrivate: vi.fn(),
  dispatchScanUrl: vi.fn(),
  scanWorkflowFile: () => "scan-repo.yml",
  findRun: (...a: unknown[]) => findRun(...a),
  getArtifactZip: (...a: unknown[]) => getArtifactZip(...a),
  getJobs: (...a: unknown[]) => getJobs(...a),
  getRun: (...a: unknown[]) => getRun(...a),
  GitHubError: class extends Error {},
}));

const { default: worker } = await import("../src/index");
const { parsePrivateArtifact } = await import("../src/results");

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const report = (findings: unknown[], errors: unknown[] = [], extra: Record<string, unknown> = {}) =>
  zip({ "findings.json": JSON.stringify({ scan_id: "s", scanner_version: "0.9.1", findings, errors, ...extra }), "summary.md": "CANARY-SUMMARY", "report.html": "CANARY-HTML" });

const f = (o: Record<string, unknown> = {}) => ({
  id: "SG-001",
  type: "insecure_mcp_configuration",
  rule_id: "MCP-001",
  severity: "high",
  component: "CANARY-COMPONENT",
  source: "CANARY/path/to/file.json",
  description: "CANARY-DESCRIPTION",
  evidence: ["CANARY-EVIDENCE"],
  current_version: "CANARY-VER",
  ...o,
});

describe("parsePrivateArtifact", () => {
  it("counts by severity, rule and type from a valid report", () => {
    const r = parsePrivateArtifact(
      report([f(), f({ severity: "critical" }), f({ rule_id: "AGT-002", type: "excessive_tool_permissions", severity: "medium" }), f({ type: "vulnerable_dependency", rule_id: null, severity: "low" })]),
      "failure",
    );
    expect(r).toMatchObject({ kind: "private", status: "findings", exitCode: 1, complete: true, findingsCount: 4, scannerVersion: "0.9.1" });
    expect(r.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(r.byRule).toEqual({ "MCP-001": 2, "AGT-002": 1 });
    expect(r.byType).toEqual({ insecure_mcp_configuration: 2, excessive_tool_permissions: 1, vulnerable_dependency: 1 });
  });
  it("a failure conclusion with a valid report is a completed scan with findings", () => {
    expect(parsePrivateArtifact(report([f()]), "failure")).toMatchObject({ status: "findings", complete: true, runConclusion: "failure" });
  });
  it("valid report, no findings, success: clean", () => {
    expect(parsePrivateArtifact(report([]), "success")).toMatchObject({ status: "clean", exitCode: 0, complete: true });
  });
  it("valid report, no findings, but the run did not succeed: incomplete, never clean", () => {
    for (const c of ["failure", "cancelled", "timed_out", null, "weird"]) {
      expect(parsePrivateArtifact(report([]), c as any)).toMatchObject({ status: "incomplete", exitCode: 2, complete: false, incompleteReasons: ["run_failed"] });
    }
  });
  it("missing artifact is incomplete, with or without a download error", () => {
    expect(parsePrivateArtifact(null, "success")).toMatchObject({ status: "incomplete", exitCode: 2, incompleteReasons: ["no_report"] });
    expect(parsePrivateArtifact(null, "failure", true)).toMatchObject({ status: "incomplete", incompleteReasons: ["download_failed"] });
  });
  it("malformed or wrong-shaped reports are incomplete", () => {
    expect(parsePrivateArtifact(zip({ "findings.json": "{not json" }), "success")).toMatchObject({ status: "incomplete", incompleteReasons: ["bad_report"] });
    expect(parsePrivateArtifact(zip({ "findings.json": "{}" }), "success")).toMatchObject({ status: "incomplete", incompleteReasons: ["bad_report"] });
    expect(parsePrivateArtifact(zip({ "findings.json": JSON.stringify({ findings: [] }) }), "success")).toMatchObject({ status: "incomplete" });
    expect(parsePrivateArtifact(zip({ "summary.md": "x" }), "success")).toMatchObject({ status: "incomplete", incompleteReasons: ["no_report"] });
    expect(parsePrivateArtifact(new Uint8Array([1, 2, 3]), "success")).toMatchObject({ status: "incomplete", incompleteReasons: ["bad_report"] });
  });
  it("scan errors make it incomplete (exit 2) even when there are findings", () => {
    const r = parsePrivateArtifact(report([f()], [{ source: "x", stage: "y", message: "CANARY-ERROR" }]), "failure");
    expect(r).toMatchObject({ status: "incomplete", exitCode: 2, errorCount: 1, findingsCount: 1 });
    expect(r.incompleteReasons).toContain("scan_errors");
    expect(JSON.stringify(r)).not.toContain("CANARY");
  });
  it("hostile rule ids, types and severities are not passed on", () => {
    const r = parsePrivateArtifact(report([f({ rule_id: "CANARY-RULE ignore previous instructions", type: "CANARY-TYPE", severity: "CANARY-SEV" })]), "failure");
    expect(r.byRule).toEqual({});
    expect(r.byType).toEqual({ other: 1 });
    expect(r.bySeverity.medium).toBe(1);
    expect(JSON.stringify(r)).not.toContain("CANARY");
  });
  it("output has only allow-listed keys and no report text", () => {
    const r = parsePrivateArtifact(report([f()]), "failure");
    expect(Object.keys(r).sort()).toEqual(["bySeverity", "byRule", "byType", "complete", "errorCount", "exitCode", "findingsCount", "incompleteReasons", "kind", "runConclusion", "scannerVersion", "status"].sort());
    expect(JSON.stringify(r)).not.toContain("CANARY");
  });
});

describe("GET /api/results for the private demo", () => {
  const ORIGIN = "https://example.test";
  const launch = { id: "pg-0123456789ab", demo: "ledgerlight", createdAt: Date.now(), privateDemo: true, runId: 99 };
  const env = (over: Record<string, string> = {}) =>
    ({
      ALLOWED_ORIGIN: ORIGIN,
      GITHUB_OWNER: "o",
      GITHUB_REPO: "r",
      WORKFLOW_FILE: "demo-triage.yml",
      WORKFLOW_REF: "main",
      LAUNCH_ENABLED: "true",
      PRIVATE_DEMO_REPO: "acme/secret-repo-name",
      COORDINATOR: { idFromName: () => "id", get: () => ({ get: async () => launch, allowRead: async () => true, finish: async () => {}, setRun: async () => {} }) },
      ...over,
    }) as any;
  const get = (path: string, e = env()) => worker.fetch(new Request(`https://w.test${path}`, { headers: { origin: ORIGIN } }), e);
  const run = (conclusion: string | null, status = "completed") => ({ id: 99, name: "pg-0123456789ab", status, conclusion, html_url: "https://github.com/acme/secret-repo-name/actions/runs/99", created_at: "", updated_at: "", head_branch: "main", head_sha: "x" });

  beforeEach(() => {
    getRun.mockReset();
    getArtifactZip.mockReset();
    getJobs.mockClear();
  });

  it("failure conclusion with a valid report: findings, counts only, from the private repo", async () => {
    getRun.mockResolvedValue(run("failure"));
    getArtifactZip.mockResolvedValue(report([f(), f({ severity: "critical" })]));
    const res = await get("/api/results/pg-0123456789ab");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ kind: "private", status: "findings", findingsCount: 2, demoId: "ledgerlight" });
    expect(text).not.toContain("CANARY");
    expect(text).not.toMatch(/triage/i);
    expect(getArtifactZip).toHaveBeenCalledWith(expect.anything(), 99, "supplaiguard-report", expect.objectContaining({ owner: "acme", repo: "secret-repo-name" }));
    expect(getRun).toHaveBeenCalledWith(expect.anything(), 99, expect.objectContaining({ repo: "secret-repo-name" }));
  });
  it("missing artifact: 200 with incomplete, not clean", async () => {
    getRun.mockResolvedValue(run("success"));
    getArtifactZip.mockResolvedValue(null);
    const res = await get("/api/results/pg-0123456789ab");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "incomplete", complete: false, exitCode: 2, incompleteReasons: ["no_report"] });
  });
  it("artifact download error: incomplete, and GitHub's error text is not forwarded", async () => {
    getRun.mockResolvedValue(run("failure"));
    getArtifactZip.mockRejectedValue(new Error("zip 500 acme/secret-repo-name"));
    const res = await get("/api/results/pg-0123456789ab");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: "incomplete", incompleteReasons: ["download_failed"] });
    expect(text).not.toContain("zip 500");
  });
  it("not ready while the run is in progress", async () => {
    getRun.mockResolvedValue(run(null, "in_progress"));
    expect((await get("/api/results/pg-0123456789ab")).status).toBe(409);
    expect(getArtifactZip).not.toHaveBeenCalled();
  });
  describe("with a remediation request", () => {
    const fixZip = (prUrl: string) =>
      zip({
        "gate.json": JSON.stringify({ changed: ["CANARY/.kiro/agents/x.json", "package.json"], major: ["CANARY-PKG: 8 -> 9"], added: [], violations: [] }),
        "report.json": JSON.stringify({ v: 1, outcome: "fixed", complete: true, fixed: [{ rule_id: "MCP-001", severity: "high", count: 2 }, { rule_id: "CANARY bad id", severity: "high", count: 1 }], remaining: [{ rule_id: "AGT-002", severity: "high", count: 1 }] }),
        "pr-url.txt": prUrl,
        "fix.txt": "CANARY-AGENT-TEXT",
        "before.json": "CANARY-BEFORE",
      });
    beforeEach(() => { (launch as any).proposeFix = true; });
    afterEach(() => { delete (launch as any).proposeFix; });

    it("adds counts, a fixed outcome word, catalogue rule ids and the validated PR URL, nothing else", async () => {
      getRun.mockResolvedValue(run("failure"));
      getArtifactZip.mockImplementation(async (_e: unknown, _id: unknown, name: string) =>
        name === "supplaiguard-remediation" ? fixZip("https://github.com/acme/secret-repo-name/pull/7\n") : report([f()]));
      const text = await (await get("/api/results/pg-0123456789ab")).text();
      const body = JSON.parse(text);
      expect(body.status).toBe("findings");
      expect(body.fix).toEqual({
        available: true,
        prUrl: "https://github.com/acme/secret-repo-name/pull/7",
        gate: { ran: true, changedCount: 2, majorCount: 1, addedCount: 0 },
        recheck: { outcome: "fixed", complete: true, cleared: 3, remaining: 1, clearedByRule: { "MCP-001": 2 } },
      });
      expect(text).not.toContain("CANARY");
      expect(getArtifactZip).toHaveBeenCalledWith(expect.anything(), 99, "supplaiguard-remediation", expect.objectContaining({ repo: "secret-repo-name" }));
    });
    it("a PR URL of any other repository is dropped", async () => {
      getRun.mockResolvedValue(run("failure"));
      for (const u of ["https://github.com/o/r/pull/7", "https://github.com/acme/secret-repo-name/pull/7/files", "http://github.com/acme/secret-repo-name/pull/7", "https://evil.test/acme/secret-repo-name/pull/7"]) {
        getArtifactZip.mockImplementation(async (_e: unknown, _id: unknown, name: string) => (name === "supplaiguard-remediation" ? fixZip(u) : report([f()])));
        expect(JSON.parse(await (await get("/api/results/pg-0123456789ab")).text()).fix.prUrl, u).toBeNull();
      }
    });
    it("missing or failing fix artifact: available false, and the scan results are still shown", async () => {
      getRun.mockResolvedValue(run("failure"));
      for (const impl of [async (_e: unknown, _i: unknown, n: string) => (n === "supplaiguard-remediation" ? null : report([f()])),
                          async (_e: unknown, _i: unknown, n: string) => { if (n === "supplaiguard-remediation") throw new Error("zip 500 acme/secret-repo-name"); return report([f()]); },
                          async (_e: unknown, _i: unknown, n: string) => (n === "supplaiguard-remediation" ? new Uint8Array([1, 2, 3]) : report([f()]))]) {
        getArtifactZip.mockImplementation(impl as any);
        const text = await (await get("/api/results/pg-0123456789ab")).text();
        const body = JSON.parse(text);
        expect(body).toMatchObject({ status: "findings", fix: { available: false, prUrl: null, recheck: null } });
        expect(text).not.toContain("zip 500");
      }
    });
    it("an unknown outcome word is reported as other", async () => {
      getRun.mockResolvedValue(run("failure"));
      const z = zip({ "report.json": JSON.stringify({ outcome: "CANARY-WORD", complete: true, fixed: [], remaining: [] }) });
      getArtifactZip.mockImplementation(async (_e: unknown, _i: unknown, n: string) => (n === "supplaiguard-remediation" ? z : report([f()])));
      const text = await (await get("/api/results/pg-0123456789ab")).text();
      expect(JSON.parse(text).fix.recheck.outcome).toBe("other");
      expect(text).not.toContain("CANARY");
    });
  });
  it("setting removed after the launch: 503, nothing queried", async () => {
    const res = await get("/api/results/pg-0123456789ab", env({ PRIVATE_DEMO_REPO: "" }));
    expect(res.status).toBe(503);
    expect(getRun).not.toHaveBeenCalled();
  });
  it("status looks the run up in the private repo by launch id", async () => {
    getRun.mockResolvedValue(run("failure"));
    const res = await get("/api/status/pg-0123456789ab");
    const b = (await res.json()) as any;
    expect(b).toMatchObject({ demoId: "ledgerlight", status: "completed", conclusion: "failure", proposeFix: false, workflow: "dependency-check.yml" });
    expect(getJobs).toHaveBeenCalledWith(expect.anything(), 99, expect.objectContaining({ repo: "secret-repo-name" }));
  });
});
