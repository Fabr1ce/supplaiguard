import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Job } from "../../types/execution";

type State = "done" | "active" | "pending" | "failed" | "skipped";
interface Stage { key: string; label: string; detail: string; state: State }

// Only steps that exist in .github/workflows/demo-triage.yml are mapped. Anything else is not shown as a stage.
const STEPS: { job: RegExp; step: RegExp | null; label: string; detail: string }[] = [
  { job: /^triage/, step: /^Deterministic scan/, label: "Discover: deterministic scan", detail: "The SupplAIGuard scanner checks the demo's dependencies, MCP configs and agent files." },
  { job: /^triage/, step: /^Headless triage/, label: "Analyze: Kiro threat-analysis agent", detail: "A read-only agent connects findings across files. It cannot run commands or write files." },
  { job: /^triage/, step: /^Upload results/, label: "Save results", detail: "Findings and agent notes are stored as a run artifact." },
  { job: /^publish/, step: /^Build the site/, label: "Build the results site", detail: "The static report page is generated from the saved results." },
  { job: /^Deploy Results/, step: null, label: "Publish to GitHub Pages", detail: "The results site is deployed." },
];

const state = (status: string, conclusion: string | null): State => {
  if (status === "in_progress") return "active";
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "done";
  if (conclusion === "skipped") return "skipped";
  return "failed";
};

export function buildStages(jobs: Job[]): Stage[] {
  return STEPS.map((spec) => {
    const base = { key: spec.label, label: spec.label, detail: spec.detail };
    const job = jobs.find((j) => spec.job.test(j.name));
    if (!job) return { ...base, state: "pending" as State };
    // The deploy job is shown as one stage: its own steps are not mapped.
    if (!spec.step) return { ...base, state: state(job.status, job.conclusion) };
    const step = job.steps.find((s) => spec.step!.test(s.name));
    return { ...base, state: step ? state(step.status, step.conclusion) : ("pending" as State) };
  });
}

const ICON: Record<State, ReactNode> = {
  done: <CheckCircle2 className="h-5 w-5 text-ok" aria-label="Completed" />,
  active: <Loader2 className="h-5 w-5 animate-spin text-green" aria-label="In progress" />,
  pending: <Circle className="h-5 w-5 text-mute" aria-label="Pending" />,
  failed: <XCircle className="h-5 w-5 text-bad" aria-label="Failed" />,
  skipped: <MinusCircle className="h-5 w-5 text-mute" aria-label="Skipped" />,
};
const WORD: Record<State, string> = { done: "Completed", active: "In progress", pending: "Pending", failed: "Failed", skipped: "Skipped" };

export default function WorkflowTimeline({ jobs, started }: { jobs: Job[]; started: boolean }) {
  const stages = buildStages(jobs);
  return (
    <ol className="space-y-1" aria-label="Execution timeline">
      {!started && <li className="mb-2 text-sm text-warn">Waiting for GitHub to start the run…</li>}
      {stages.map((s) => (
        <li key={s.key} className={`flex gap-3 rounded-lg p-2 ${s.state === "active" ? "lab-pulse lab-pulse-static" : ""}`} aria-current={s.state === "active" ? "step" : undefined}>
          <span className="mt-0.5">{ICON[s.state]}</span>
          <div>
            <p className="text-sm font-medium">{s.label} <span className="ml-1 text-xs font-normal text-mute">{WORD[s.state]}</span></p>
            <p className="text-xs text-mute">{s.detail}</p>
          </div>
        </li>
      ))}
      <li className="flex gap-3 rounded-lg border border-dashed border-line p-2">
        <MinusCircle className="mt-0.5 h-5 w-5 text-mute" aria-hidden />
        <div>
          <p className="text-sm font-medium">Remediate and Verify <span className="ml-1 text-xs font-normal text-mute">Not part of this workflow</span></p>
          <p className="text-xs text-mute">This run is a scan and read-only triage. It does not change code or re-scan a fix.</p>
        </div>
      </li>
    </ol>
  );
}
