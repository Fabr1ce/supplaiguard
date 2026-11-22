import type { FixOutcome } from "../types/execution";

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
