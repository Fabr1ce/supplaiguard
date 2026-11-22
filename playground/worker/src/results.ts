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

export interface FixResult {
  /** Draft PR opened by the workflow. Null when none was opened. Only a github.com pull URL of this repository is passed on. */
  prUrl: string | null;
  /** Outcome of scanner/fix_gate.py, which decides deterministically what the agent may change. */
  gate: { ran: boolean; changed: string[]; major: string[]; added: string[] };
  /** Scanner re-run after the change (scanner/evolution_report.py). */
  recheck: { outcome: string; complete: boolean | null; cleared: number; remaining: number } | null;
}

const countOf = (v: unknown) =>
  Array.isArray(v) ? v.reduce((n: number, f: any) => n + (typeof f?.count === "number" && f.count > 0 ? Math.min(f.count, 10_000) : 0), 0) : 0;

/** Reduces the propose-fix artifact to an allow-listed shape. The agent's own text (fix.txt) is never passed on. */
export function parseFixArtifact(zip: Uint8Array, owner: string, repo: string): FixResult {
  const files = unzipSync(zip, { filter: (f) => ["gate.json", "report.json", "pr-url.txt"].includes(f.name) && f.originalSize < 200_000 });
  const read = (n: string) => (files[n] ? strFromU8(files[n]) : null);
  const json = (n: string): any => {
    try {
      const j = JSON.parse(read(n) ?? "null");
      return j && typeof j === "object" ? j : null;
    } catch {
      return null;
    }
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 50).map((x) => str(x, 200)).filter(Boolean) : []);

  const url = (read("pr-url.txt") ?? "").trim().split(/\s+/).pop() ?? "";
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prUrl = new RegExp(`^https://github\\.com/${esc(owner)}/${esc(repo)}/pull/\\d{1,9}$`).test(url) ? url : null;

  const g = json("gate.json");
  const r = json("report.json");
  return {
    prUrl,
    gate: { ran: !!g, changed: list(g?.changed), major: list(g?.major), added: list(g?.added) },
    recheck: r
      ? { outcome: str(r.outcome, 40), complete: typeof r.complete === "boolean" ? r.complete : null, cleared: countOf(r.fixed), remaining: countOf(r.remaining) }
      : null,
  };
}
