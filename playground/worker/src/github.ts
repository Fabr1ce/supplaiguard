import type { Env } from "./env";

const API = "https://api.github.com";
const TIMEOUT_MS = 8000;

export class GitHubError extends Error {}

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function appJwt(env: Env): Promise<string> {
  const pem = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (!pem.includes("BEGIN PRIVATE KEY")) throw new GitHubError("private key must be PKCS#8");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: env.GITHUB_APP_ID }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function gh(url: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  try {
    return await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "supplaiguard-playground",
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new GitHubError("github unreachable");
  }
}

let cached: { token: string; exp: number } | null = null;

/** Installation token limited to this one repository and to Actions access. */
async function installationToken(env: Env): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const jwt = await appJwt(env);
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const inst = await gh(`${API}/repos/${repo}/installation`, { token: jwt });
  if (!inst.ok) throw new GitHubError(`installation lookup ${inst.status}`);
  const { id } = (await inst.json()) as { id: number };
  const res = await gh(`${API}/app/installations/${id}/access_tokens`, {
    token: jwt,
    method: "POST",
    body: JSON.stringify({ repositories: [env.GITHUB_REPO], permissions: { actions: "write" } }),
  });
  if (!res.ok) throw new GitHubError(`token ${res.status}`);
  const t = (await res.json()) as { token: string; expires_at: string };
  cached = { token: t.token, exp: Date.parse(t.expires_at) };
  return t.token;
}

const repoPath = (env: Env) => `${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;

/** `propose-fix` is added to the workflow inputs only when asked for; the workflow input defaults to false. */
export async function dispatch(env: Env, demo: string, launchId: string, proposeFix = false): Promise<void> {
  const token = await installationToken(env);
  const res = await gh(`${repoPath(env)}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
    token,
    method: "POST",
    body: JSON.stringify({ ref: env.WORKFLOW_REF, inputs: { demo, launch_id: launchId, ...(proposeFix ? { "propose-fix": "true" } : {}) } }),
  });
  if (res.status !== 204) throw new GitHubError(`dispatch ${res.status}`);
}

/** Name of the workflow file used for scan-by-URL runs. */
export const scanWorkflowFile = (env: Env) => env.SCAN_URL_WORKFLOW_FILE || "scan-repo.yml";

/**
 * Dispatches scan-repo.yml. `repo` and `ref` MUST be the normalized values from parseRepoRef: nothing the visitor
 * typed is passed on. The workflow input `ref` is an empty string when no branch or tag was asked for.
 */
export async function dispatchScanUrl(env: Env, repo: string, ref: string | null, launchId: string): Promise<void> {
  const token = await installationToken(env);
  const res = await gh(`${repoPath(env)}/actions/workflows/${scanWorkflowFile(env)}/dispatches`, {
    token,
    method: "POST",
    body: JSON.stringify({ ref: env.WORKFLOW_REF, inputs: { repo, ref: ref ?? "", launch_id: launchId } }),
  });
  if (res.status !== 204) throw new GitHubError(`dispatch ${res.status}`);
}

export interface RunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  head_branch: string;
  head_sha: string;
}

export async function getRun(env: Env, runId: number): Promise<RunInfo | null> {
  const token = await installationToken(env);
  const res = await gh(`${repoPath(env)}/actions/runs/${runId}`, { token });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(`run ${res.status}`);
  return (await res.json()) as RunInfo;
}

/** The dispatch response has no run id, so find the run whose name carries our launch id. */
export async function findRun(env: Env, launchId: string, since: number, workflowFile: string = env.WORKFLOW_FILE): Promise<RunInfo | null> {
  const token = await installationToken(env);
  const created = new Date(since - 60_000).toISOString().slice(0, 19) + "Z";
  const res = await gh(
    `${repoPath(env)}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=30&created=%3E%3D${encodeURIComponent(created)}`,
    { token },
  );
  if (!res.ok) throw new GitHubError(`list ${res.status}`);
  const j = (await res.json()) as { workflow_runs: RunInfo[] };
  return j.workflow_runs.find((r) => r.name.split(/\s+/).includes(launchId)) ?? null;
}

export interface JobInfo {
  name: string;
  status: string;
  conclusion: string | null;
  steps: { name: string; status: string; conclusion: string | null }[];
}

export async function getJobs(env: Env, runId: number): Promise<JobInfo[]> {
  const token = await installationToken(env);
  const res = await gh(`${repoPath(env)}/actions/runs/${runId}/jobs?per_page=30`, { token });
  if (!res.ok) throw new GitHubError(`jobs ${res.status}`);
  const j = (await res.json()) as { jobs: (JobInfo & { steps?: JobInfo["steps"] })[] };
  return j.jobs.map((x) => ({
    name: x.name,
    status: x.status,
    conclusion: x.conclusion,
    steps: (x.steps ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
  }));
}

/** Downloads the artifact zip for the run and returns its bytes. */
export async function getArtifactZip(env: Env, runId: number, name: string): Promise<Uint8Array | null> {
  const token = await installationToken(env);
  const list = await gh(`${repoPath(env)}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}`, { token });
  if (!list.ok) throw new GitHubError(`artifacts ${list.status}`);
  const a = ((await list.json()) as { artifacts: { id: number; expired: boolean; size_in_bytes: number }[] }).artifacts[0];
  if (!a || a.expired || a.size_in_bytes > 5_000_000) return null;
  const zip = await gh(`${repoPath(env)}/actions/artifacts/${a.id}/zip`, { token });
  if (!zip.ok) throw new GitHubError(`zip ${zip.status}`);
  return new Uint8Array(await zip.arrayBuffer());
}
