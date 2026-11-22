import type { Execution, Job } from "../types/execution";

/**
 * Development-only simulated run, used by `#/run/<any id>?demo=sim` (see useExecution).
 * Query options: end=success|failure|cancelled (default success), fix=1 to include the propose-fix job.
 * Step names match .github/workflows/demo-triage.yml. Nothing here ships in production builds.
 */
const SEC = 8;
type S = [name: string, seconds: number];
const TRIAGE: S[] = [
  ["Check the key is available", 1],
  ["Deterministic scan of the original demo (no secrets)", 1.5],
  ["Copy the demo and disable its MCP configs", 1.5],
  ["Install Kiro CLI", 1],
  ["Headless triage inside the demo copy (read-only)", 3],
  ["Upload results", 0.5],
];
const FIX: S[] = [["Scan before the fix", 1], ["The Remediation agent proposes edits in the copy", 2], ["Open a DRAFT pull request", 1]];
const PUBLISH: S[] = [["Build the site", 1], ["Upload the site", 0.5]];

export function simulateExecution(elapsed: number, end = "success", fix = false, launchId = "sim"): Execution {
  const queuedFor = SEC;
  const raw = elapsed - queuedFor;
  let cursor = 0;
  let stop = false; // the failure or cancel point ends everything after it
  const endAt = (list: S[]) => list.reduce((a, [, s]) => a + s * SEC, 0);
  const total = endAt(TRIAGE) + (fix ? endAt(FIX) : 0) + endAt(PUBLISH);
  const failAt = end === "success" ? Infinity : endAt(TRIAGE) * 0.7;
  const t = Math.min(raw, failAt); // time freezes at the failure or cancel point

  const build = (name: string, list: S[], lastJob = false): Job => {
    const steps = list.map(([n, s]) => {
      const from = cursor;
      cursor += s * SEC;
      let status = "pending";
      let conclusion: string | null = null;
      if (!stop && t >= from + s * SEC) { status = "completed"; conclusion = "success"; }
      else if (!stop && t >= from) { status = "in_progress"; }
      if (!stop && raw >= failAt && status === "in_progress") { status = "completed"; conclusion = end === "cancelled" ? "cancelled" : "failure"; stop = true; }
      return { name: n, status, conclusion };
    });
    const started = steps.some((x) => x.status !== "pending");
    const finished = steps.every((x) => x.status === "completed");
    return {
      name, steps,
      status: finished ? "completed" : started ? "in_progress" : "queued",
      conclusion: finished ? (steps.every((x) => x.conclusion === "success") ? "success" : steps.find((x) => x.conclusion !== "success")?.conclusion ?? null) : null,
    };
  };
  const jobs: Job[] = raw < 0 ? [] : [build("triage", TRIAGE), ...(fix ? [build("Propose Fix (Draft PR)", FIX)] : []), build("publish", PUBLISH)];
  const over = raw >= total || stop;
  return {
    launchId, demoId: "vulnerable-ai-app", status: raw < 0 ? "queued" : over ? "completed" : "in_progress",
    conclusion: over ? (stop ? (end === "cancelled" ? "cancelled" : "failure") : "success") : null,
    runUrl: null, runId: null, branch: "main", workflow: "demo-triage.yml",
    createdAt: new Date(Date.now() - elapsed * 1000).toISOString(), startedAt: null, completedAt: null, jobs: raw < 0 ? [] : jobs,
  };
}
