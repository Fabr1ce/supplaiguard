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
