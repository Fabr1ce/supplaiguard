import { describe, expect, it } from "vitest";
import demos from "../data/demos.json";
import { canLaunchPrivate } from "./api";
import { AGENT_SUMMARY_NOTE, PRIVATE_LINK_NOTE, describePrivate } from "./privateDemo";
import { unavailableNote } from "../components/demos/DemoGrid";
import { currentFlavor, doneKeys, stepKeyFor } from "./flavor";
import type { PrivateResults } from "../types/execution";
import type { Demo } from "../types/demo";

const base: PrivateResults = {
  kind: "private",
  launchId: "pg-0123456789ab",
  demoId: "ledgerlight",
  runUrl: "https://github.com/x/y/actions/runs/1",
  exitCode: 1,
  status: "findings",
  complete: true,
  findingsCount: 3,
  bySeverity: { critical: 0, high: 2, medium: 1, low: 0 },
  byRule: { "AGT-001": 2, "MCP-001": 1 },
  byType: { excessive_tool_permissions: 2, insecure_mcp_configuration: 1 },
  incompleteReasons: [],
  errorCount: 0,
  runConclusion: "failure",
  scannerVersion: "0.9.1",
};

describe("the Ledgerlight card entry", () => {
  const entry = (demos as Demo[]).find((d) => d.id === "ledgerlight")!;
  it("exists and is marked private", () => {
    expect(entry).toBeTruthy();
    expect(entry.private).toBe(true);
  });
  it("has only the allowed keys and no expected-findings fields", () => {
    expect(Object.keys(entry).sort()).toEqual(["description", "id", "name", "private"]);
    for (const k of ["findings", "bySeverity", "categories", "scannerVersion"]) expect(k in entry).toBe(false);
  });
  it("has no digits in its description (no counts)", () => {
    expect(entry.description).not.toMatch(/\d/);
  });
  it("the public demos still carry their findings", () => {
    for (const d of (demos as Demo[]).filter((x) => !x.private)) expect(d.findings?.length).toBeGreaterThan(0);
  });
});

describe("card availability", () => {
  const d = (demos as Demo[]).find((x) => x.id === "ledgerlight")!;
  const pub = (demos as Demo[]).find((x) => x.id === "crypt-keeper-mcp")!;
  it("public demos are never marked unavailable", () => {
    for (const v of [true, false, null]) expect(unavailableNote(pub, v)).toBeNull();
  });
  it("private demo: not connected unless the service says so", () => {
    expect(unavailableNote(d, false)).toBe("Not connected yet");
    expect(unavailableNote(d, null)).toMatch(/Checking/);
    expect(unavailableNote(d, true)).toBeNull();
  });
  it("canLaunchPrivate needs the flag and launching on; an older Worker means off", () => {
    expect(canLaunchPrivate(null)).toBe(false);
    expect(canLaunchPrivate({ ok: true, launchEnabled: true })).toBe(false);
    expect(canLaunchPrivate({ ok: true, launchEnabled: true, privateDemoAvailable: false })).toBe(false);
    expect(canLaunchPrivate({ ok: true, launchEnabled: false, privateDemoAvailable: true })).toBe(false);
    expect(canLaunchPrivate({ ok: true, launchEnabled: true, privateDemoAvailable: true })).toBe(true);
  });
});

describe("describePrivate", () => {
  it("findings with a failure conclusion read as a finished scan", () => {
    const v = describePrivate(base);
    expect(v.tone).toBe("findings");
    expect(v.headline).toMatch(/completed and found 3 issues/);
    expect(v.lines.join(" ")).toMatch(/scan itself finished/);
    expect(v.rules).toEqual([["AGT-001", 2], ["MCP-001", 1]]);
    expect(v.types[0]).toEqual(["Excessive agent permissions", 2]);
  });
  it("clean only when the report says so", () => {
    expect(describePrivate({ ...base, status: "clean", exitCode: 0, findingsCount: 0, byRule: {}, byType: {}, runConclusion: "success" }).tone).toBe("ok");
  });
  it("incomplete is never presented as clean", () => {
    const v = describePrivate({ ...base, status: "incomplete", exitCode: 2, complete: false, findingsCount: 0, incompleteReasons: ["no_report"] });
    expect(v.tone).toBe("incomplete");
    expect(v.headline).toMatch(/NOT a clean result/);
    expect(v.lines.join(" ")).toMatch(/No report/);
  });
  it("unknown finding types are labelled Other", () => {
    expect(describePrivate({ ...base, byType: { weird: 1 } }).types).toEqual([["Other", 1]]);
  });
  it("the copy says the agent summary is in the private run, without saying it did not run", () => {
    expect(AGENT_SUMMARY_NOTE).toMatch(/shown in the private run/);
    expect(AGENT_SUMMARY_NOTE).not.toMatch(/did not run|not run|skipped|no agent/i);
    expect(PRIVATE_LINK_NOTE).toMatch(/404/);
    for (const t of [AGENT_SUMMARY_NOTE, PRIVATE_LINK_NOTE]) expect(t).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("flavour mapping for the reusable workflow's real names", () => {
  it("maps the called scan job's steps without claiming progress that did not happen", () => {
    for (const s of ["Validate inputs", "Check out the repository to scan", "Download the pinned SupplAIGuard scanner", "Set up Python", "Load suppressions (trusted source only)"]) {
      expect(stepKeyFor("check / scan", s)).toBe("prepare");
    }
    expect(stepKeyFor("check / scan", "Scan")).toBe("scan");
    for (const s of ["Publish job summary", "Upload report", "Gate"]) expect(stepKeyFor("check / scan", s)).toBe("publish");
    expect(stepKeyFor("check / scan")).toBe("prepare");
  });
  it("maps agent triage steps; only the triage step is triage", () => {
    expect(stepKeyFor("check / agent-triage", "Triage the findings (read-only, clean directory)")).toBe("triage");
    for (const s of ["Decide whether it is safe to run", "Download the scan report", "Install Kiro CLI"]) expect(stepKeyFor("check / agent-triage", s)).toBe("prepare");
  });
  it("unknown called jobs fall back to unknown", () => {
    expect(stepKeyFor("check / other", "x")).toBe("unknown");
  });
  it("the plain scan-by-URL job mapping is unchanged", () => {
    expect(stepKeyFor("scan", "Scan")).toBe("fetchscan");
  });
  it("skipped triage steps are not reported as done", () => {
    const jobs = [
      { name: "check / scan", status: "completed", conclusion: "failure", steps: [{ name: "Scan", status: "completed", conclusion: "success" }] },
      { name: "check / agent-triage", status: "completed", conclusion: "success", steps: [{ name: "Triage the findings (read-only, clean directory)", status: "completed", conclusion: "skipped" }] },
    ];
    expect(doneKeys(jobs)).toContain("scan");
    expect(doneKeys(jobs)).not.toContain("triage");
  });
  it("current flavour follows the real in-progress step", () => {
    const jobs = [{ name: "check / scan", status: "in_progress", conclusion: null, steps: [{ name: "Scan", status: "in_progress", conclusion: null }] }];
    expect(currentFlavor("in_progress", null, jobs)).toEqual({ key: "scan", status: "running" });
  });
});
