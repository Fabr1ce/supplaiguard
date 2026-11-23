import { describe, expect, it } from "vitest";
import clientSource from "./repoRef.ts?raw";
import workerSource from "../../worker/src/repoRef.ts?raw";
import { EXAMPLE_TARGETS, checkRepoInput, describeScan } from "./scanUrl";
import { parseRepoRef } from "./repoRef";
import type { ScanUrlResults } from "../types/execution";
import corpus from "../../../scanner/tests/fixtures/injection_corpus.json";
import shared from "../../../scanner/tests/fixtures/github_ref_cases.json";

describe("client-side validator is the same code as the Worker's", () => {
  it("is a byte-identical copy of playground/worker/src/repoRef.ts", () => {
    expect(clientSource).toBe(workerSource);
  });
  it("agrees with the shared cases generated from scanner/github_fetch.py", () => {
    for (const c of shared.cases) {
      const r = parseRepoRef(c.input, c.ref);
      expect(r.ok, JSON.stringify(c)).toBe(c.accepted);
    }
  });
  it("rejects the shared adversarial corpus", () => {
    for (const b of corpus.bad_inputs) expect((b.kind === "url" ? parseRepoRef(b.value) : parseRepoRef("o/r", b.value)).ok, JSON.stringify(b.value)).toBe(false);
  });
});

describe("checkRepoInput", () => {
  it("normalizes and treats a blank branch as none", () => {
    expect(checkRepoInput("https://github.com/Octo/Hello.git", "")).toEqual({ ok: true, repo: "Octo/Hello", ref: null });
    expect(checkRepoInput("o/r", "  ")).toEqual({ ok: true, repo: "o/r", ref: null });
    expect(checkRepoInput("o/r", "v1.2")).toEqual({ ok: true, repo: "o/r", ref: "v1.2" });
  });
  it("attributes errors to the right field with fixed messages", () => {
    expect(checkRepoInput("https://evil.test/o/r", "")).toMatchObject({ ok: false, field: "repo" });
    expect(checkRepoInput("o/r", "--upload-pack=x")).toMatchObject({ ok: false, field: "ref" });
    expect(checkRepoInput("o/r", "a..b")).toMatchObject({ ok: false, field: "ref" });
    expect(checkRepoInput("", "")).toMatchObject({ ok: false, field: "repo" });
    const r = checkRepoInput("o/r\u202eXYZSECRET", "");
    if (!r.ok) expect(r.message).not.toContain("XYZSECRET");
  });
});

const base: ScanUrlResults = {
  kind: "scan-url", launchId: "pg-0123456789ab", demoId: "scan-url", runUrl: "https://github.com/x/y/actions/runs/1", scanUrl: { repo: "o/r", ref: null },
  repository: "github.com/o/r@abc1234", scanId: "s", scannerVersion: "1", exitCode: 0, status: "clean", complete: true, findingsCount: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, suspiciousContent: 0, incompleteReasons: [], nothingRecognised: false, errorCount: 0,
};

describe("describeScan", () => {
  it("clean only for a complete scan", () => {
    expect(describeScan(base)).toMatchObject({ tone: "ok", headline: "The scan completed with no findings." });
  });
  it("says so when nothing recognised was scanned", () => {
    expect(describeScan({ ...base, nothingRecognised: true }).lines.join(" ")).toMatch(/says little/);
  });
  it("findings", () => {
    expect(describeScan({ ...base, status: "findings", exitCode: 1, findingsCount: 1 }).headline).toMatch(/found 1 issue\./);
  });
  it("incomplete is never clean, whatever else the object says", () => {
    const v = describeScan({ ...base, status: "incomplete", exitCode: 2, complete: false, incompleteReasons: ["fetch_failed", "limits"], findingsCount: 0 });
    expect(v.tone).toBe("incomplete");
    expect(v.headline).toMatch(/NOT a clean result/);
    expect(v.headline).not.toMatch(/no findings/i);
    expect(v.lines.join(" ")).toMatch(/could not be fetched/);
    expect(describeScan({ ...base, status: "incomplete", exitCode: 2, complete: false, findingsCount: 3 }).lines.join(" ")).toMatch(/There may be more/);
  });
  it("mentions agent-instruction-like text as flagged, not followed", () => {
    expect(describeScan({ ...base, status: "findings", exitCode: 1, findingsCount: 1, suspiciousContent: 1 }).lines.join(" ")).toMatch(/flagged, not followed/);
  });
});

describe("example targets", () => {
  it("every example passes the same validation a typed repository does", () => {
    for (const t of EXAMPLE_TARGETS) expect(checkRepoInput(t.repo, "").ok, t.repo).toBe(true);
  });
});
