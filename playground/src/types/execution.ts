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
}

export interface StoredRun {
  launchId: string;
  demoId: string;
  createdAt: string;
  status: RunStatus;
  conclusion: string | null;
}
