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

export type ScanStatus = "clean" | "findings" | "incomplete";

export interface ScanUrlResult {
  kind: "scan-url";
  /** "github.com/owner/repo@sha7" when the artifact has a value of exactly that shape, otherwise null. */
  repository: string | null;
  scanId: string;
  scannerVersion: string;
  /** 0 clean, 1 findings, 2 scan errors or incomplete. Same meaning as scanner/sg_scan.py. */
  exitCode: 0 | 1 | 2;
  status: ScanStatus;
  /** False whenever the scanner reported an error, hit a limit or produced no usable report. Never true for status "incomplete". */
  complete: boolean;
  findingsCount: number;
  /** All four keys are always present. */
  bySeverity: { critical: number; high: number; medium: number; low: number };
  /** Findings of type suspicious_agent_skill: text in the repository that reads like an instruction to an agent. */
  suspiciousContent: number;
  /** Fixed reason codes only. Text from the scan (error messages, file names) is never passed on. */
  incompleteReasons: ("no_report" | "fetch_failed" | "limits" | "scan_errors" | "bad_report" | "exit_code")[];
  /** No error, no findings, but nothing the scanner recognises was in the repository. Clean, but proves little. */
  nothingRecognised: boolean;
  errorCount: number;
}

const REPOSITORY_RE = /^github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}(@[0-9a-f]{7})?$/;
const SHA_ONLY_RE = /^[0-9a-f]{7}$/;

/**
 * Reduces the scan-repo artifact (findings.json, exit-code.txt) to an allow-listed shape of numbers, enums and one
 * validated repository string. The scanned repository is untrusted: none of its text is passed on.
 * Fails closed: anything missing or malformed is "incomplete", never "clean".
 */
export function parseScanArtifact(zip: Uint8Array): ScanUrlResult {
  let files: Record<string, Uint8Array> = {};
  try {
    files = unzipSync(zip, { filter: (f) => ["findings.json", "exit-code.txt"].includes(f.name) && f.originalSize < 2_000_000 });
  } catch {
    files = {};
  }
  const read = (n: string) => (files[n] ? strFromU8(files[n]) : null);

  let raw: any = null;
  try {
    raw = JSON.parse(read("findings.json") ?? "null");
  } catch {
    raw = null;
  }
  const reasons: ScanUrlResult["incompleteReasons"] = [];
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  let findingsCount = 0;
  let suspicious = 0;
  let errorCount = 0;
  let nothingRecognised = false;

  const usable = raw && typeof raw === "object" && Array.isArray(raw.findings) && Array.isArray(raw.errors);
  if (!raw) reasons.push(read("findings.json") === null ? "no_report" : "bad_report");
  else if (!usable) reasons.push("bad_report");

  if (usable) {
    for (const f of raw.findings as any[]) {
      findingsCount++;
      const sev = f && SEVERITIES.has(f.severity) ? (f.severity as keyof typeof bySeverity) : "medium";
      bySeverity[sev]++;
      if (f && f.type === "suspicious_agent_skill") suspicious++;
    }
    const errors = raw.errors as any[];
    errorCount = errors.length;
    if (errorCount) {
      reasons.push("scan_errors");
      if (errors.some((e) => e && e.source === "github.fetch")) reasons.push("fetch_failed");
      if (errors.some((e) => e && e.source === "scanner/limits")) reasons.push("limits");
    }
    const fs = raw.coverage && typeof raw.coverage === "object" ? raw.coverage.files_scanned : null;
    if (!fs || typeof fs !== "object") {
      if (!errorCount) reasons.push("bad_report");
    } else {
      nothingRecognised = Object.values(fs).every((n) => n === 0);
    }
  }

  const fileExit = (read("exit-code.txt") ?? "").trim();
  const recorded = /^[012]$/.test(fileExit) ? Number(fileExit) : null;
  if (recorded === 2) reasons.push("exit_code");

  let exitCode: 0 | 1 | 2;
  if (reasons.length) exitCode = 2;
  else exitCode = findingsCount > 0 ? 1 : 0;
  if (recorded !== null && recorded > exitCode) exitCode = recorded as 0 | 1 | 2;

  const status: ScanStatus = exitCode === 2 ? "incomplete" : exitCode === 1 ? "findings" : "clean";
  const repoStr = usable && typeof raw.repository === "string" ? raw.repository : "";
  const sha = usable && raw.source && typeof raw.source.commit === "string" ? raw.source.commit.slice(0, 7) : "";
  let repository: string | null = REPOSITORY_RE.test(repoStr) ? repoStr : null;
  if (repository && !repository.includes("@") && SHA_ONLY_RE.test(sha)) repository = `${repository}@${sha}`;
  return {
    kind: "scan-url",
    repository,
    scanId: usable ? str(raw.scan_id, 60) : "",
    scannerVersion: usable ? str(raw.scanner_version, 20) : "",
    exitCode,
    status,
    complete: status !== "incomplete",
    findingsCount,
    bySeverity,
    suspiciousContent: suspicious,
    incompleteReasons: [...new Set(reasons)],
    nothingRecognised: status === "clean" && nothingRecognised,
    errorCount,
  };
}
