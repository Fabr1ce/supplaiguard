import type { ScanUrlResults } from "../types/execution";
import { parseRepoRef } from "./repoRef";

export type RepoInput = { ok: true; repo: string; ref: string | null } | { ok: false; field: "repo" | "ref"; message: string };

/**
 * Client-side check of the card's two fields with the same rules as the Worker (a port of scanner/github_fetch.py).
 * It only gives quick feedback: the Worker validates again and is the authority. Blank fields are not errors here;
 * the caller decides when to show them.
 */
export function checkRepoInput(repo: string, ref: string): RepoInput {
  const r = parseRepoRef(repo, ref.trim() === "" ? undefined : ref);
  if (r.ok) return { ok: true, repo: r.slug, ref: r.ref };
  return { ok: false, field: r.message.startsWith("Branch or tag") ? "ref" : "repo", message: r.message };
}

/**
 * Public, intentionally vulnerable multi-agent projects offered as one-click examples. Clicking one only fills the
 * form; the visitor still presses Scan, and the same validation and limits apply. Both are third-party projects
 * that we did not write, and we scan them as read-only inputs.
 */
export const EXAMPLE_TARGETS = [
  { repo: "opena2a-org/damn-vulnerable-ai-agent", label: "Damn Vulnerable AI Agent", note: "Many deliberately weak agents over MCP and A2A (JavaScript)" },
  { repo: "GenAI-Security-Project/finbot-ctf", label: "OWASP FinBot CTF", note: "Multi-agent finance app built for capture-the-flag play (Python, uv.lock)" },
] as const;

/** Plain-language reasons a scan could not be completed. Fixed text only. */
export const REASON_TEXT: Record<string, string> = {
  fetch_failed: "The repository could not be fetched (it may not exist, may be private, or may be too large).",
  limits: "The scanner hit a limit (too many or too large files, or links it skipped), so part of the repository was not scanned.",
  scan_errors: "The scanner reported errors.",
  no_report: "No report was saved for this run.",
  bad_report: "The saved report could not be read.",
  exit_code: "The workflow recorded that the scan did not complete.",
};

export interface ScanView {
  tone: "ok" | "findings" | "incomplete";
  headline: string;
  lines: string[];
}

/** What the results page says. A scan that did not complete never reads as clean. */
export function describeScan(r: ScanUrlResults): ScanView {
  const lines: string[] = [];
  if (r.status === "incomplete") {
    for (const k of r.incompleteReasons) if (REASON_TEXT[k]) lines.push(REASON_TEXT[k]);
    if (r.findingsCount > 0) lines.push(`Findings found before it stopped: ${r.findingsCount}. There may be more.`);
    return { tone: "incomplete", headline: "The scan did not complete. This is NOT a clean result.", lines };
  }
  if (r.suspiciousContent > 0) lines.push(`${r.suspiciousContent} finding(s) are text in the repository that reads like an instruction to an AI agent. It was flagged, not followed. Open the report to see it.`);
  if (r.status === "findings") return { tone: "findings", headline: `The scan completed and found ${r.findingsCount} issue${r.findingsCount === 1 ? "" : "s"}.`, lines };
  if (r.nothingRecognised) lines.push("Nothing the scanner knows how to check was found (MCP configs, agent files, skills, lockfiles, requirements files), so this says little about the repository.");
  return { tone: "ok", headline: "The scan completed with no findings.", lines };
}
