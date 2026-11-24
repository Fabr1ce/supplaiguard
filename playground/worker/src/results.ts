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

/** Artifact the reusable scan workflow uploads. Same name the scan-by-URL flow reads. */
export const PRIVATE_REPORT_ARTIFACT = "supplaiguard-report";

const KNOWN_TYPES = new Set([
  "vulnerable_dependency",
  "insecure_mcp_configuration",
  "excessive_tool_permissions",
  "suspicious_agent_skill",
  "insecure_integration_configuration",
]);
const RULE_ID_RE = /^[A-Z]{2,5}-\d{3}$/;
const CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "skipped", "failed_to_start"]);

export interface PrivateResult {
  kind: "private";
  /** Always "incomplete" without a usable report. Never "clean" unless a valid report has no findings and no errors. */
  status: ScanStatus;
  /** 0 clean, 1 findings, 2 scan errors or incomplete. Same meaning as scanner/sg_scan.py. */
  exitCode: 0 | 1 | 2;
  complete: boolean;
  findingsCount: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  /** Rule ids matching the scanner's catalogue pattern (for example AGT-001). Anything else is not passed on. */
  byRule: Record<string, number>;
  /** Only the scanner's known finding types. Anything else is counted as "other". */
  byType: Record<string, number>;
  /** Fixed reason codes only. */
  incompleteReasons: ("no_report" | "download_failed" | "bad_report" | "scan_errors" | "run_failed")[];
  errorCount: number;
  /** The run's own conclusion, mapped to a fixed set. A "failure" with a valid report is a finished scan with findings. */
  runConclusion: string | null;
  scannerVersion: string;
}

const MAX_RULES = 50;

/**
 * Reduces the private demo's report to counts. The repository is private but this page is public, so NOTHING from
 * the report's text is passed on: no paths, evidence, descriptions, components or error messages. Only numbers,
 * severities from a fixed set, rule ids matching the catalogue pattern and the scanner's known finding types.
 * Fails closed: a missing, failed or malformed report is "incomplete", never "clean".
 */
export function parsePrivateArtifact(zip: Uint8Array | null, conclusion: string | null, downloadFailed = false): PrivateResult {
  const reasons: PrivateResult["incompleteReasons"] = [];
  let raw: any = null;
  if (zip) {
    try {
      const files = unzipSync(zip, { filter: (f) => f.name === "findings.json" && f.originalSize < 2_000_000 });
      const txt = files["findings.json"] ? strFromU8(files["findings.json"]) : null;
      if (txt === null) reasons.push("no_report");
      else raw = JSON.parse(txt);
    } catch {
      reasons.push("bad_report");
    }
  } else reasons.push(downloadFailed ? "download_failed" : "no_report");

  const usable = !!raw && typeof raw === "object" && Array.isArray(raw.findings) && Array.isArray(raw.errors);
  if (raw && !usable && !reasons.includes("bad_report")) reasons.push("bad_report");

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byRule: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let findingsCount = 0;
  let errorCount = 0;
  if (usable) {
    for (const f of raw.findings as any[]) {
      findingsCount++;
      bySeverity[f && SEVERITIES.has(f.severity) ? (f.severity as keyof typeof bySeverity) : "medium"]++;
      const t = f && typeof f.type === "string" && KNOWN_TYPES.has(f.type) ? f.type : "other";
      byType[t] = (byType[t] ?? 0) + 1;
      const r = f && typeof f.rule_id === "string" && RULE_ID_RE.test(f.rule_id) ? f.rule_id : null;
      if (r && (r in byRule || Object.keys(byRule).length < MAX_RULES)) byRule[r] = (byRule[r] ?? 0) + 1;
    }
    errorCount = Math.min((raw.errors as unknown[]).length, 10_000);
    if (errorCount) reasons.push("scan_errors");
  }

  const runConclusion = conclusion && CONCLUSIONS.has(conclusion) ? conclusion : null;
  // A valid report with findings is a finished scan whatever the run conclusion says: the gate fails the run on purpose.
  // Without findings, a non-success run cannot be called clean.
  if (usable && !reasons.length && findingsCount === 0 && runConclusion !== "success") reasons.push("run_failed");

  const exitCode: 0 | 1 | 2 = reasons.length ? 2 : findingsCount > 0 ? 1 : 0;
  const status: ScanStatus = exitCode === 2 ? "incomplete" : exitCode === 1 ? "findings" : "clean";
  return {
    kind: "private",
    status,
    exitCode,
    complete: status !== "incomplete",
    findingsCount,
    bySeverity,
    byRule,
    byType,
    incompleteReasons: [...new Set(reasons)],
    errorCount,
    runConclusion,
    scannerVersion: usable ? str(raw.scanner_version, 20) : "",
  };
}

/** Artifact uploaded by the reusable remediate.yml (gate.json, report.json, pr-url.txt, agent text). */
export const PRIVATE_FIX_ARTIFACT = "supplaiguard-remediation";

export interface PrivateFixResult {
  /** False when the artifact is missing, expired or unreadable. Never read as "fixed". */
  available: boolean;
  /** Draft PR in the private repository. Only a pull URL of that exact repository is passed on; visitors without access get a 404. */
  prUrl: string | null;
  /** Counts only: the private repository's file names and package names are not passed on. */
  gate: { ran: boolean; changedCount: number; majorCount: number; addedCount: number };
  /** The scanner re-run after the change. `cleared` and `remaining` by catalogue rule id only. */
  recheck: { outcome: "fixed" | "no_change" | "unverified" | "other"; complete: boolean | null; cleared: number; remaining: number; clearedByRule: Record<string, number> } | null;
}

const OUTCOMES = new Set(["fixed", "no_change", "unverified"]);

/**
 * Reduces the private remediation artifact to numbers, a fixed outcome word, catalogue rule ids and a validated PR URL.
 * The agent's text, file paths and package names never reach the public page.
 */
export function parsePrivateFixArtifact(zip: Uint8Array | null, owner: string, repo: string): PrivateFixResult {
  const none: PrivateFixResult = { available: false, prUrl: null, gate: { ran: false, changedCount: 0, majorCount: 0, addedCount: 0 }, recheck: null };
  if (!zip) return none;
  let base: FixResult;
  let report: any = null;
  try {
    base = parseFixArtifact(zip, owner, repo);
    const files = unzipSync(zip, { filter: (f) => f.name === "report.json" && f.originalSize < 200_000 });
    report = files["report.json"] ? JSON.parse(strFromU8(files["report.json"])) : null;
  } catch {
    return none;
  }
  const clearedByRule: Record<string, number> = {};
  if (report && Array.isArray(report.fixed)) {
    for (const f of report.fixed.slice(0, MAX_RULES)) {
      const r = f && typeof f.rule_id === "string" && RULE_ID_RE.test(f.rule_id) ? f.rule_id : null;
      const n = f && typeof f.count === "number" && f.count > 0 ? Math.min(f.count, 10_000) : 0;
      if (r && n) clearedByRule[r] = (clearedByRule[r] ?? 0) + n;
    }
  }
  const rc = base.recheck;
  return {
    available: true,
    prUrl: base.prUrl,
    gate: { ran: base.gate.ran, changedCount: base.gate.changed.length, majorCount: base.gate.major.length, addedCount: base.gate.added.length },
    recheck: rc
      ? { outcome: (OUTCOMES.has(rc.outcome) ? rc.outcome : "other") as "fixed" | "no_change" | "unverified" | "other", complete: rc.complete, cleared: rc.cleared, remaining: rc.remaining, clearedByRule }
      : null,
  };
}
