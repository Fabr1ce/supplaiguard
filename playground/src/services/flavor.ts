import type { Job } from "../types/execution";

/**
 * Flavour text for the Execution page. Pure and deterministic: the same input always gives the same line.
 * The lines are decoration only. The real step and state are always shown next to them (see statusLine).
 * References come from the public-domain novel and general gothic laboratory tropes.
 */

export type StepKey = "queued" | "prepare" | "scan" | "fetchscan" | "copy" | "triage" | "fix" | "publish" | "unknown";
export type FlavorStatus = "running" | "complete" | "success" | "failure" | "cancelled";

/** Order of the real workflow, used to scale the lightning. Higher means a stronger storm. */
export const STEP_INTENSITY: Record<StepKey, number> = {
  queued: 0.15, prepare: 0.3, scan: 0.45, fetchscan: 0.5, copy: 0.6, triage: 0.8, fix: 0.88, publish: 0.95, unknown: 0.5,
};

export const STEP_LABEL: Record<StepKey, string> = {
  queued: "Waiting for GitHub",
  prepare: "Preparing the run",
  scan: "Deterministic scan",
  fetchscan: "Fetch and scan the repository",
  copy: "Copy the demo",
  triage: "Kiro triage",
  fix: "Propose fix",
  publish: "Publish results",
  unknown: "Working",
};

/** Running lines: each step has 4 to 6. None may claim that anything finished. */
export const RUNNING: Record<StepKey, string[]> = {
  queued: [
    "Waiting for a bolt of lightning from GitHub",
    "The storm is gathering over the tower",
    "Warming the laboratory lamps",
    "The assistant is dusting off the tables",
    "Waiting for a free workbench in the lab",
  ],
  prepare: [
    "Sweeping the floor and checking the keys",
    "Lighting the lamps and laying out the tools",
    "Sharpening the scalpels, as scientists do",
    "Winding up the great machine, one crank at a time",
    "The assistant hauls in the heavy cables",
  ],
  scan: [
    "Attaching the electrodes",
    "Counting the torches in the village",
    "Reading every stitch of the dependency list",
    "Testing each bolt on the neck for rust",
    "Checking the creature's notes for strange ink",
  ],
  // Scan by URL (scan-repo.yml). One real step does both the shallow clone and the scan, so the lines cover both and none claims either finished.
  fetchscan: [
    "Sending the carriage to fetch the specimen",
    "The specimen is read where it lies, never woken",
    "Nothing from the specimen is allowed to move",
    "Counting every torch and bolt in the village",
    "Reading the notes in the margins, with gloves on",
  ],
  copy: [
    "Fetching the specimen",
    "Carrying the specimen up the tower stairs",
    "Making a spare so the original stays safe",
    "Unplugging the dangerous parts before the storm",
    "Laying the copy out on the slab",
  ],
  triage: [
    "Consulting the agents in the tower",
    "The agents lean over the slab, murmuring",
    "Joining one clue to the next, like stitches",
    "Sorting real monsters from shadows on the wall",
    "The agents may look but never touch the specimen",
    "Thunder rolls while the notes pile up",
  ],
  fix: [
    "Stitching the patches together",
    "Threading the needle with great care",
    "Every stitch is inspected before it is allowed",
    "A draft is laid out for human eyes only",
    "The assistant holds the lantern steady",
  ],
  publish: [
    "Opening the laboratory doors",
    "Hanging the findings on the tower wall",
    "Polishing the brass for visitors",
    "Rolling the report out to the village square",
    "Sweeping the steps before the guests arrive",
  ],
  unknown: [
    "The machinery hums in the dark",
    "Something stirs beneath the sheet",
    "Lightning flickers across the windows",
    "Gears turn somewhere below the floor",
    "A candle gutters, and the work goes on",
  ],
};

/** One-time line shown when a step really finished with a success conclusion. */
export const STEP_DONE: Record<StepKey, string> = {
  queued: "Step complete: the storm has arrived",
  prepare: "Step complete: the laboratory is ready",
  scan: "Step complete: every torch has been counted",
  fetchscan: "Step complete: the scanner has run",
  copy: "Step complete: the specimen is on the slab",
  triage: "Step complete: the agents have spoken",
  fix: "Step complete: the stitches are in place",
  publish: "Step complete: the doors are open",
  unknown: "Step complete: the machinery rests",
};

export const RUN_SUCCESS = [
  "It lives. Results are ready.",
  "The doors stand open. Results are ready.",
  "A steady glow fills the tower. Results are ready.",
];
export const RUN_FAILURE = [
  "The storm broke the machine. Open the run for details.",
  "The lamps went out. Check the run log.",
  "The experiment stopped early. Nothing more will happen here.",
];
export const RUN_CANCELLED = [
  "The experiment was called off. The lamps are dimmed.",
  "The lever was pulled back. The lab sits quiet.",
  "The assistant covers the slab and goes home.",
];

/**
 * Picks a line. `tick` counts rotations since the step began. Consecutive ticks give different lines
 * because every list has at least two entries. Unknown keys fall back to the generic list.
 * Callers pass "success" only when the real run conclusion is success.
 */
export function pickFlavor(stepKey: string, status: FlavorStatus, tick: number): string {
  const t = Number.isFinite(tick) ? Math.abs(Math.trunc(tick)) : 0;
  const pick = (a: string[]) => a[t % a.length];
  const key = (stepKey in RUNNING ? stepKey : "unknown") as StepKey;
  switch (status) {
    case "success": return pick(RUN_SUCCESS);
    case "failure": return pick(RUN_FAILURE);
    case "cancelled": return pick(RUN_CANCELLED);
    case "complete": return STEP_DONE[key];
    default: return pick(RUNNING[key]);
  }
}

/** The real status shown beside the flavour line. */
export function statusLine(stepKey: string, status: FlavorStatus): string {
  const key = (stepKey in RUNNING ? stepKey : "unknown") as StepKey;
  switch (status) {
    case "success": return "Run: completed successfully";
    case "failure": return "Run: failed";
    case "cancelled": return "Run: cancelled";
    case "complete": return `${STEP_LABEL[key]}: done`;
    default: return key === "queued" ? "Queued: waiting for GitHub to start" : `${STEP_LABEL[key]}: running`;
  }
}

/** Maps a real GitHub job and step name (see demo-triage.yml) to a step key. */
export function stepKeyFor(jobName: string, stepName?: string): StepKey {
  if (/^propose/i.test(jobName)) return "fix";
  if (/^scan$/i.test(jobName)) {
    // scan-repo.yml: the single job "scan".
    if (!stepName) return "prepare";
    if (/^Scan$/.test(stepName)) return "fetchscan";
    if (/^(Publish job summary|Upload report|Gate)/.test(stepName)) return "publish";
    return "prepare";
  }
  if (/^(publish|deploy)/i.test(jobName)) return "publish";
  if (/^triage/i.test(jobName)) {
    if (!stepName) return "prepare";
    if (/^Deterministic scan/.test(stepName)) return "scan";
    if (/^Copy the demo/.test(stepName)) return "copy";
    if (/^(Headless triage|Upload results)/.test(stepName)) return "triage";
    return "prepare";
  }
  return "unknown";
}

export interface RunFlavor { key: StepKey | "run"; status: FlavorStatus }

/** What the run is doing now, from the real status, conclusion and jobs. */
export function currentFlavor(status: string | undefined, conclusion: string | null | undefined, jobs: Job[]): RunFlavor {
  if (status === "completed") {
    if (conclusion === "success") return { key: "run", status: "success" };
    return { key: "run", status: conclusion === "cancelled" ? "cancelled" : "failure" };
  }
  if (status !== "in_progress") return { key: "queued", status: "running" };
  for (const j of jobs) {
    if (j.status !== "in_progress") continue;
    const step = j.steps.find((s) => s.status === "in_progress");
    return { key: stepKeyFor(j.name, step?.name), status: "running" };
  }
  return { key: "unknown", status: "running" };
}

/** Step keys whose real work finished with a success conclusion. */
export function doneKeys(jobs: Job[]): StepKey[] {
  const out = new Set<StepKey>();
  for (const j of jobs) {
    if (/^(propose|publish|deploy)/i.test(j.name)) {
      if (j.status === "completed" && j.conclusion === "success") out.add(stepKeyFor(j.name));
      continue;
    }
    for (const s of j.steps) if (s.status === "completed" && s.conclusion === "success") out.add(stepKeyFor(j.name, s.name));
  }
  return [...out];
}

/** 0 to 1. Lightning strength grows with the real step. Terminal states are handled by the caller. */
export const intensityFor = (key: StepKey | "run"): number => (key === "run" ? 0 : STEP_INTENSITY[key]);
