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
}
