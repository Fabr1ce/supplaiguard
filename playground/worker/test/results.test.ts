import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseArtifact } from "../src/results";

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
