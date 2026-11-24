import type { FixOutcome, PrivateFixOutcome } from "../types/execution";

export interface FixView {
  tone: "ok" | "none" | "blocked" | "unknown";
  headline: string;
  lines: string[];
}

/** Plain-language summary of a remediation run. Uses only what the Worker passed on, never agent text. */
export function describeFix(fix: FixOutcome): FixView {
  if (!fix.available) {
    return { tone: "unknown", headline: "The remediation details are not available for this run.", lines: ["The saved files may have expired. The workflow run lists what the agent and the gate did."] };
  }
  const lines: string[] = [];
  if (fix.gate?.ran) {
    if (fix.gate.changed.length) lines.push(`Files the agent changed (allow-listed by the gate): ${fix.gate.changed.join(", ")}.`);
    for (const m of fix.gate.major) lines.push(`Needs explicit approval, major or unparseable version change: ${m}.`);
    for (const a of fix.gate.added) lines.push(`Needs explicit approval, new dependency not checked here: ${a}.`);
  }
  if (fix.recheck) {
    const c = fix.recheck;
    lines.push(`Scanner re-check: ${c.outcome || "unknown"}; ${c.cleared} cleared, ${c.remaining} still open${c.complete === false ? " (the re-scan did not complete)" : ""}. Tests were not run.`);
  }
  if (fix.prUrl) return { tone: "ok", headline: "A draft pull request was opened. A person must review it; nothing merges automatically.", lines };
  if (fix.gate && !fix.gate.ran) return { tone: "blocked", headline: "No pull request was opened. The agent step or the gate did not finish; see the workflow run.", lines };
  return { tone: "none", headline: "No pull request was opened. The agent proposed no allowed change, or the gate refused one.", lines };
}

const OUTCOME_TEXT: Record<string, string> = {
  fixed: "the scanner confirms findings were cleared",
  no_change: "no finding was cleared",
  unverified: "the re-scan did not complete, so nothing is confirmed as fixed",
  other: "the outcome could not be read",
};

/** Same summary for the private demo, from counts only: its file and package names are never sent to this page. */
export function describePrivateFix(fix: PrivateFixOutcome): FixView {
  if (!fix.available) {
    return { tone: "unknown", headline: "The remediation details are not available for this run.", lines: ["The saved files may have expired, or the fix job did not upload them. Nothing here says the findings were fixed."] };
  }
  const lines: string[] = [];
  const g = fix.gate;
  if (g.ran) {
    lines.push(`The gate allowed ${g.changedCount} changed file${g.changedCount === 1 ? "" : "s"} (manifests, agent, skill and MCP config only).`);
    if (g.majorCount) lines.push(`${g.majorCount} major or unparseable version change${g.majorCount === 1 ? " needs" : "s need"} explicit approval.`);
    if (g.addedCount) lines.push(`${g.addedCount} new dependenc${g.addedCount === 1 ? "y needs" : "ies need"} explicit approval.`);
  }
  if (fix.recheck) {
    const c = fix.recheck;
    const rules = Object.entries(c.clearedByRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r, n]) => `${r} x${n}`);
    lines.push(`Scanner re-check: ${OUTCOME_TEXT[c.outcome] ?? OUTCOME_TEXT.other}; ${c.cleared} cleared, ${c.remaining} still open. Tests were not run.`);
    if (rules.length) lines.push(`Cleared by rule: ${rules.join(", ")}.`);
  }
  if (fix.prUrl) return { tone: "ok", headline: "A draft pull request was opened in the private repository. A person must review it; nothing merges automatically.", lines };
  if (!g.ran) return { tone: "blocked", headline: "No pull request was opened. The agent step or the gate did not finish.", lines };
  return { tone: "none", headline: "No pull request was opened. The agent proposed no allowed change, or the gate refused one.", lines };
}
