import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseArtifact, parseFixArtifact } from "../src/results";

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("parseArtifact", () => {
  it("keeps only allow-listed fields and never claims remediation or verification", () => {
    const r = parseArtifact(
      zip({
        "findings.json": JSON.stringify({ scan_id: "s1", scanner_version: "0.2.0", findings: [{ id: "SG-001", type: "vulnerable_dependency", severity: "bogus", component: "x", secret: "nope", evidence: ["GHSA-1"] }] }),
        "triage.txt": "notes",
        "triage.exit": "0\n",
        "mcp-disabled.txt": "2\n",
        "other.txt": "ignored",
      }),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("medium");
    expect(Object.keys(r.findings[0])).not.toContain("secret");
    expect(r.triage).toEqual({ exitCode: 0, text: "notes" });
    expect(r.mcpConfigsDisabled).toBe(2);
    expect(r.remediationApplied).toBe(false);
    expect(r.verificationRun).toBe(false);
  });
  it("survives missing and malformed files", () => {
    const r = parseArtifact(zip({ "findings.json": "{not json" }));
    expect(r.findings).toEqual([]);
    expect(r.triage.exitCode).toBeNull();
  });
});

describe("parseFixArtifact", () => {
  const files = {
    "gate.json": JSON.stringify({ changed: ["package.json"], major: [], added: [], secret: "no" }),
    "report.json": JSON.stringify({ outcome: "improved", complete: true, fixed: [{ rule_id: "X", severity: "high", count: 2 }], remaining: [{ count: 1 }] }),
    "pr-url.txt": "https://github.com/o/r/pull/12\n",
    "fix.txt": "agent text must not pass",
  };
  it("passes on the draft PR link, the gate and the re-check only", () => {
    const f = parseFixArtifact(zip(files), "o", "r");
    expect(f).toEqual({
      prUrl: "https://github.com/o/r/pull/12",
      gate: { ran: true, changed: ["package.json"], major: [], added: [] },
      recheck: { outcome: "improved", complete: true, cleared: 2, remaining: 1 },
    });
    expect(JSON.stringify(f)).not.toContain("agent text");
  });
  it.each(["https://evil.example/o/r/pull/1", "https://github.com/o/other/pull/1", "javascript:alert(1)", "https://github.com/o/r/pull/1/../../x", ""])(
    "drops a PR url that is not a pull request of this repository: %j",
    (u) => {
      expect(parseFixArtifact(zip({ ...files, "pr-url.txt": u }), "o", "r").prUrl).toBeNull();
    },
  );
  it("survives a missing or malformed artifact", () => {
    expect(parseFixArtifact(zip({ "gate.json": "{no" }), "o", "r")).toEqual({ prUrl: null, gate: { ran: false, changed: [], major: [], added: [] }, recheck: null });
  });
});
