export type RunStatus = "queued" | "in_progress" | "completed";

export interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  steps: { name: string; status: string; conclusion: string | null }[];
}

export interface Execution {
  launchId: string;
  demoId: string;
  status: RunStatus;
  /** success | failure | cancelled | failed_to_start | ... */
  conclusion: string | null;
  runUrl: string | null;
  runId: number | null;
  branch: string;
  workflow: string;
  /** Present for a scan by URL: the normalized repository and ref the Worker dispatched. */
  scanUrl?: { repo: string; ref: string | null };
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  jobs: Job[];
}

export interface ResultFinding {
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

export interface FixOutcome {
  /** false: the fix artifact is missing or expired. */
  available: boolean;
  prUrl: string | null;
  gate?: { ran: boolean; changed: string[]; major: string[]; added: string[] };
  recheck?: { outcome: string; complete: boolean | null; cleared: number; remaining: number } | null;
}

export interface Results {
  launchId: string;
  demoId: string;
  runUrl: string;
  scanId: string;
  scannerVersion: string;
  findings: ResultFinding[];
  bySeverity: Record<string, number>;
  triage: { exitCode: number | null; text: string };
  mcpConfigsDisabled: number | null;
  remediationApplied: false;
  verificationRun: false;
  /** Present only when this run asked for remediation. */
  fix?: FixOutcome;
}

export interface StoredRun {
  launchId: string;
  demoId: string;
  createdAt: string;
  status: RunStatus;
  conclusion: string | null;
}

/** Result of a scan by URL. Numbers, enums and one validated repository string: no text from the scanned repository. */
export interface ScanUrlResults {
  kind: "scan-url";
  launchId: string;
  demoId: "scan-url";
  runUrl: string;
  scanUrl: { repo: string; ref: string | null };
  repository: string | null;
  scanId: string;
  scannerVersion: string;
  /** 0 clean, 1 findings, 2 scan errors or incomplete. */
  exitCode: 0 | 1 | 2;
  status: "clean" | "findings" | "incomplete";
  complete: boolean;
  findingsCount: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  suspiciousContent: number;
  incompleteReasons: string[];
  nothingRecognised: boolean;
  errorCount: number;
}

/**
 * Result of the private demo. Numbers, enums, catalogue rule ids and known finding types only: the repository is
 * private but this page is public, so no path, evidence, description or component name ever reaches the browser.
 */
export interface PrivateResults {
  kind: "private";
  launchId: string;
  demoId: string;
  /** Link to the run in the private repository. A visitor without access gets a 404 from GitHub. */
  runUrl: string;
  /** 0 clean, 1 findings, 2 scan errors or incomplete. */
  exitCode: 0 | 1 | 2;
  status: "clean" | "findings" | "incomplete";
  complete: boolean;
  findingsCount: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byRule: Record<string, number>;
  byType: Record<string, number>;
  incompleteReasons: string[];
  errorCount: number;
  runConclusion: string | null;
  scannerVersion: string;
}
