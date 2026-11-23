import type { Env } from "./env";
import { DEMOS } from "./demos";

/**
 * The private demo: a workflow in a separate, private repository. Configured only by Worker vars.
 * Nothing a visitor sends ever reaches these values; the repository name is never put in a response.
 */
export interface PrivateTarget {
  id: string;
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
}

export const DEFAULT_PRIVATE_DEMO_ID = "ledgerlight";
const SLUG_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.ya?ml$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** The id the browser uses for the private demo. Never one of the public demo ids or "scan-url". */
export function privateDemoId(env: Pick<Env, "PRIVATE_DEMO_ID">): string | null {
  const id = env.PRIVATE_DEMO_ID?.trim() || DEFAULT_PRIVATE_DEMO_ID;
  if (!ID_RE.test(id) || id === "scan-url" || Object.prototype.hasOwnProperty.call(DEMOS, id)) return null;
  return id;
}

/** Returns the target, or null when the demo is not configured or any value is invalid. Fails closed. */
export function privateTarget(env: Pick<Env, "PRIVATE_DEMO_REPO" | "PRIVATE_DEMO_WORKFLOW_FILE" | "PRIVATE_DEMO_REF" | "PRIVATE_DEMO_ID">): PrivateTarget | null {
  const slug = env.PRIVATE_DEMO_REPO?.trim();
  if (!slug) return null;
  const m = SLUG_RE.exec(slug);
  if (!m || m[2] === "." || m[2] === ".." || m[2].endsWith(".git")) return null;
  const workflowFile = env.PRIVATE_DEMO_WORKFLOW_FILE?.trim() || "dependency-check.yml";
  if (!FILE_RE.test(workflowFile) || workflowFile.includes("..")) return null;
  const ref = env.PRIVATE_DEMO_REF?.trim() || "main";
  if (!REF_RE.test(ref) || ref.includes("..")) return null;
  const id = privateDemoId(env);
  if (!id) return null;
  return { id, owner: m[1], repo: m[2], workflowFile, ref };
}
