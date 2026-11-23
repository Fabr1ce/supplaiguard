import type { PrivateResults } from "../types/execution";

/** Plain-language reasons a private scan could not be confirmed. Fixed text only. */
export const PRIVATE_REASON_TEXT: Record<string, string> = {
  no_report: "No report was saved for this run, or it has expired.",
  download_failed: "The report could not be downloaded just now. Reloading this page may help.",
  bad_report: "The saved report could not be read.",
  scan_errors: "The scanner reported errors.",
  run_failed: "The run did not succeed and its report shows no findings, so it cannot be called clean.",
};

/** Labels for the scanner's finding types. Unknown types are shown as "Other". */
export const TYPE_LABEL: Record<string, string> = {
  vulnerable_dependency: "Vulnerable dependency",
  insecure_mcp_configuration: "Insecure MCP configuration",
  excessive_tool_permissions: "Excessive agent permissions",
  suspicious_agent_skill: "Suspicious agent instructions",
  insecure_integration_configuration: "Insecure integration configuration",
  other: "Other",
};

export interface PrivateView {
  tone: "ok" | "findings" | "incomplete";
  headline: string;
  lines: string[];
  /** Rule ids and finding types, sorted by count then name, so the output is stable. */
  rules: [string, number][];
  types: [string, number][];
}

const sorted = (o: Record<string, number>): [string, number][] => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** What the results page says. A scan that did not complete never reads as clean. */
export function describePrivate(r: PrivateResults): PrivateView {
  const lines: string[] = [];
  const rules = sorted(r.byRule);
  const types = sorted(r.byType).map(([k, n]) => [TYPE_LABEL[k] ?? "Other", n] as [string, number]);
  if (r.status === "incomplete") {
    for (const k of r.incompleteReasons) if (PRIVATE_REASON_TEXT[k]) lines.push(PRIVATE_REASON_TEXT[k]);
    if (r.findingsCount > 0) lines.push(`Findings found before it stopped: ${r.findingsCount}. There may be more.`);
    return { tone: "incomplete", headline: "The scan did not complete. This is NOT a clean result.", lines, rules, types };
  }
  if (r.status === "findings") {
    if (r.runConclusion === "failure") lines.push("The run is marked failed because the check fails on findings at or above its threshold. The scan itself finished.");
    return { tone: "findings", headline: `The scan completed and found ${r.findingsCount} issue${r.findingsCount === 1 ? "" : "s"}.`, lines, rules, types };
  }
  return { tone: "ok", headline: "The scan completed with no findings.", lines, rules, types };
}

/** Said on the results page. The agent summary is part of the private run, not this page; it is not implied to be missing. */
export const AGENT_SUMMARY_NOTE =
  "The agent summary is shown in the private run, not here. This page shows only counts, rule ids, severities and finding types from the scan report.";

export const PRIVATE_LINK_NOTE = "The run is in a private repository. GitHub shows a 404 unless you have access to it; rely on this page for the results.";
