import { unzipSync, strFromU8 } from "fflate";

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export interface Finding {
  id: string;
  type: string;
  ruleId: string;
  severity: string;
  component: string;
  source: string;
  description: string;
  currentVersion: string;
  recommendedVersion: string;
  evidence: string[];
  remediationAvailable: boolean;
}

export interface Results {
  scanId: string;
  scannerVersion: string;
  findings: Finding[];
  bySeverity: Record<string, number>;
  /** Agent output. Untrusted text: the browser must render it as plain text. */
  triage: { exitCode: number | null; text: string };
  mcpConfigsDisabled: number | null;
  /** The triage workflow never edits files or re-scans. These are always false for it. */
  remediationApplied: false;
  verificationRun: false;
}

/** Reduces the artifact to an allow-listed, size-limited shape. */
export function parseArtifact(zip: Uint8Array): Results {
  const files = unzipSync(zip, { filter: (f) => ["findings.json", "triage.txt", "triage.exit", "mcp-disabled.txt"].includes(f.name) && f.originalSize < 2_000_000 });
  const read = (n: string) => (files[n] ? strFromU8(files[n]) : null);

  let raw: any = {};
  try {
    raw = JSON.parse(read("findings.json") ?? "{}");
  } catch {
    raw = {};
  }
  const list: any[] = Array.isArray(raw.findings) ? raw.findings.slice(0, 200) : [];
  const findings: Finding[] = list.map((f) => ({
    id: str(f.id, 20),
    type: str(f.type, 60),
    ruleId: str(f.rule_id, 20),
    severity: SEVERITIES.has(f.severity) ? f.severity : "medium",
    component: str(f.component, 120),
    source: str(f.source, 200),
    description: str(f.description, 600),
    currentVersion: str(f.current_version, 60),
    recommendedVersion: str(f.recommended_version, 60),
    evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 10).map((e: unknown) => str(e, 200)) : [],
    remediationAvailable: f.remediation_available === true,
  }));
  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  const exit = read("triage.exit");
  const mcp = read("mcp-disabled.txt");
  return {
    scanId: str(raw.scan_id, 60),
    scannerVersion: str(raw.scanner_version, 20),
    findings,
    bySeverity,
    triage: { exitCode: exit && /^\d+$/.test(exit.trim()) ? Number(exit.trim()) : null, text: (read("triage.txt") ?? "").slice(0, 20000) },
    mcpConfigsDisabled: mcp && /^\d+$/.test(mcp.trim()) ? Number(mcp.trim()) : null,
    remediationApplied: false,
    verificationRun: false,
  };
}
