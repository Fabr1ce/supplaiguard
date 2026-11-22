export function duration(start: string | null, end: string | null, now = Date.now()): string {
  if (!start) return "–";
  const ms = (end ? Date.parse(end) : now) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "–");

export type Outcome = "ready" | "queued" | "in_progress" | "success" | "failure" | "cancelled";

/** Maps GitHub's status and conclusion to the states shown in the UI. */
export function outcome(status: string | undefined, conclusion: string | null | undefined): Outcome {
  if (!status) return "ready";
  if (status === "queued") return "queued";
  if (status === "in_progress") return "in_progress";
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled") return "cancelled";
  return "failure";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  ready: "Ready",
  queued: "Queued",
  in_progress: "In progress",
  success: "Completed successfully",
  failure: "Failed",
  cancelled: "Cancelled",
};

export function findingsMarkdown(demoId: string, runUrl: string, findings: { id: string; ruleId: string; severity: string; component: string; source: string }[]): string {
  const rows = findings.map((f) => `| ${f.id} | ${f.ruleId || "dependency"} | ${f.severity} | ${f.component} | ${f.source} |`);
  return [`# SupplAIGuard results: ${demoId}`, "", `Run: ${runUrl}`, "", "| Id | Rule | Severity | Component | Source |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}
