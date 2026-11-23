import { describe, expect, it } from "vitest";
import {
  RUN_CANCELLED, RUN_FAILURE, RUN_SUCCESS, RUNNING, STEP_DONE, currentFlavor, doneKeys, pickFlavor, statusLine, stepKeyFor,
  type StepKey,
} from "./flavor";

const keys = Object.keys(RUNNING) as StepKey[];
const all = [...Object.values(RUNNING).flat(), ...Object.values(STEP_DONE), ...RUN_SUCCESS, ...RUN_FAILURE, ...RUN_CANCELLED];
const BANNED = /success|passed|complete/i;

describe("flavor catalogue", () => {
  it("has 4 to 6 running lines for every step", () => {
    for (const k of keys) {
      expect(RUNNING[k].length).toBeGreaterThanOrEqual(4);
      expect(RUNNING[k].length).toBeLessThanOrEqual(6);
    }
  });
  it("has no empty, long or dash-punctuated lines", () => {
    for (const m of all) {
      expect(m.trim().length).toBeGreaterThan(0);
      expect(m.length).toBeLessThanOrEqual(80);
      expect(m).not.toMatch(/[\u2014\u2013]/);
    }
  });
  it("uses success, passed and complete only in the branches that earn them", () => {
    for (const m of [...Object.values(RUNNING).flat(), ...RUN_FAILURE, ...RUN_CANCELLED]) expect(m).not.toMatch(BANNED);
    for (const m of Object.values(STEP_DONE)) expect(m).toMatch(/complete/);
  });
  it("has no repeated lines across running lists", () => {
    const run = Object.values(RUNNING).flat();
    expect(new Set(run).size).toBe(run.length);
  });
});

describe("pickFlavor", () => {
  it("is deterministic", () => {
    for (const k of keys) for (let t = 0; t < 20; t++) expect(pickFlavor(k, "running", t)).toBe(pickFlavor(k, "running", t));
  });
  it("never repeats the previous line on consecutive ticks", () => {
    for (const k of keys) for (let t = 0; t < 60; t++) expect(pickFlavor(k, "running", t + 1)).not.toBe(pickFlavor(k, "running", t));
    for (const s of ["success", "failure", "cancelled"] as const) for (let t = 0; t < 12; t++) expect(pickFlavor("run", s, t + 1)).not.toBe(pickFlavor("run", s, t));
  });
  it("falls back safely for unknown keys and bad ticks", () => {
    expect(RUNNING.unknown).toContain(pickFlavor("nope", "running", 3));
    expect(pickFlavor("nope", "complete", 0)).toBe(STEP_DONE.unknown);
    expect(RUNNING.unknown).toContain(pickFlavor("scan-typo", "running", Number.NaN));
    expect(RUNNING.scan).toContain(pickFlavor("scan", "running", -7));
  });
  it("is somber on failure and cancel", () => {
    for (let t = 0; t < 6; t++) {
      for (const s of ["failure", "cancelled"] as const) {
        const m = pickFlavor("run", s, t);
        expect(m).not.toMatch(BANNED);
        expect(m).not.toMatch(/lives|alive|ready|!/i);
      }
    }
  });
  it("only celebrates on the success status", () => {
    expect(pickFlavor("run", "success", 0)).toBe("It lives. Results are ready.");
    for (const k of keys) for (let t = 0; t < 8; t++) expect(pickFlavor(k, "running", t)).not.toMatch(/lives|ready/i);
  });
});

describe("real state mapping", () => {
  const job = (name: string, status: string, conclusion: string | null, steps: [string, string, string | null][]) => ({
    name, status, conclusion, steps: steps.map(([n, s, c]) => ({ name: n, status: s, conclusion: c })),
  });
  it("maps workflow step names", () => {
    expect(stepKeyFor("triage", "Deterministic scan of the original demo (no secrets)")).toBe("scan");
    expect(stepKeyFor("triage", "Copy the demo and disable its MCP configs")).toBe("copy");
    expect(stepKeyFor("triage", "Headless triage inside the demo copy (read-only)")).toBe("triage");
    expect(stepKeyFor("Propose Fix (Draft PR)", "Open a DRAFT pull request")).toBe("fix");
    expect(stepKeyFor("publish", "Build the site")).toBe("publish");
    expect(stepKeyFor("Deploy Results")).toBe("publish");
    expect(stepKeyFor("other")).toBe("unknown");
  });
  it("maps scan-repo.yml (scan by URL) job and step names", () => {
    expect(stepKeyFor("scan")).toBe("prepare");
    expect(stepKeyFor("scan", "Validate inputs")).toBe("prepare");
    expect(stepKeyFor("scan", "Check out SupplAIGuard")).toBe("prepare");
    expect(stepKeyFor("scan", "Set up Python")).toBe("prepare");
    expect(stepKeyFor("scan", "Scan")).toBe("fetchscan");
    expect(stepKeyFor("scan", "Publish job summary")).toBe("publish");
    expect(stepKeyFor("scan", "Upload report")).toBe("publish");
    expect(stepKeyFor("scan", "Gate")).toBe("publish");
    expect(stepKeyFor("scan", "Something else")).toBe("prepare");
    expect(currentFlavor("in_progress", null, [job("scan", "in_progress", null, [["Scan", "in_progress", null]])])).toEqual({ key: "fetchscan", status: "running" });
    expect(statusLine("fetchscan", "running")).toBe("Fetch and scan the repository: running");
  });
  it("scan-by-URL flavour never claims progress that did not happen", () => {
    // Only a step that really finished with success is listed as done, and its line says only that the scanner ran.
    expect(doneKeys([job("scan", "in_progress", null, [["Validate inputs", "completed", "success"], ["Scan", "in_progress", null]])])).toEqual(["prepare"]);
    expect(doneKeys([job("scan", "in_progress", null, [["Scan", "completed", "failure"]])])).toEqual([]);
    for (const m of RUNNING.fetchscan) expect(m).not.toMatch(BANNED);
    expect(STEP_DONE.fetchscan).not.toMatch(/clean|safe|no findings|secure/i);
  });
  it("derives the current state from the run", () => {
    expect(currentFlavor("queued", null, [])).toEqual({ key: "queued", status: "running" });
    expect(currentFlavor("in_progress", null, [job("triage", "in_progress", null, [["Deterministic scan x", "in_progress", null]])])).toEqual({ key: "scan", status: "running" });
    expect(currentFlavor("in_progress", null, [])).toEqual({ key: "unknown", status: "running" });
    expect(currentFlavor("completed", "success", [])).toEqual({ key: "run", status: "success" });
    expect(currentFlavor("completed", "failure", [])).toEqual({ key: "run", status: "failure" });
    expect(currentFlavor("completed", "failed_to_start", [])).toEqual({ key: "run", status: "failure" });
    expect(currentFlavor("completed", "cancelled", [])).toEqual({ key: "run", status: "cancelled" });
  });
  it("lists only steps that really succeeded", () => {
    const d = doneKeys([job("triage", "in_progress", null, [["Deterministic scan x", "completed", "success"], ["Copy the demo x", "completed", "failure"]])]);
    expect(d).toEqual(["scan"]);
  });
  it("always pairs a line with the real status text", () => {
    expect(statusLine("scan", "running")).toBe("Deterministic scan: running");
    expect(statusLine("run", "failure")).toBe("Run: failed");
    expect(statusLine("run", "success")).toBe("Run: completed successfully");
  });
});
