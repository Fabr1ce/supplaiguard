import type { Coordinator } from "./coordinator";

export interface Env {
  COORDINATOR: DurableObjectNamespace<Coordinator>;
  // secrets
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string; // PKCS#8 PEM, see README
  // vars
  ALLOWED_ORIGIN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  WORKFLOW_FILE: string;
  WORKFLOW_REF: string;
  LAUNCH_ENABLED: string;
  DAILY_CAP: string;
  PER_CLIENT_LAUNCHES_PER_HOUR: string;
  /** Off unless exactly "true". The only switch that lets a visitor request remediation. */
  PROPOSE_FIX_ENABLED?: string;
  PROPOSE_FIX_DAILY_CAP?: string;
  PROPOSE_FIX_PER_CLIENT_PER_DAY?: string;
  /** Off unless exactly "true". The only switch that lets a visitor scan a repository by URL. */
  SCAN_URL_ENABLED?: string;
  SCAN_URL_DAILY_CAP?: string;
  SCAN_URL_PER_CLIENT_PER_DAY?: string;
  /** Workflow file for URL scans. Defaults to scan-repo.yml. */
  SCAN_URL_WORKFLOW_FILE?: string;
  /**
   * The private demo (a workflow in a separate private repository), as owner/name. Empty or invalid means NOT
   * configured: launches are refused and /api/health reports privateDemoAvailable: false.
   */
  PRIVATE_DEMO_REPO?: string;
  /** Defaults to dependency-check.yml. */
  PRIVATE_DEMO_WORKFLOW_FILE?: string;
  /** Branch to dispatch on. Defaults to main. */
  PRIVATE_DEMO_REF?: string;
  /** Demo id the browser uses. Defaults to ledgerlight. */
  PRIVATE_DEMO_ID?: string;
  PRIVATE_DEMO_DAILY_CAP?: string;
  PRIVATE_DEMO_PER_CLIENT_PER_DAY?: string;
  /**
   * Remediation for the private demo: the run also opens a draft PR in the private repository. Its own switch, off
   * unless exactly "true", independent of PROPOSE_FIX_ENABLED. Shares the remediation caps (PROPOSE_FIX_*).
   */
  PRIVATE_DEMO_FIX_ENABLED?: string;
}
