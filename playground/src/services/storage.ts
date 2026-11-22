import type { Execution, StoredRun } from "../types/execution";

const KEY = "sg.runs.v1";
const FIRST = "sg.intro.seen.v1";

export function loadRuns(): StoredRun[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => /^pg-[0-9a-f]{12}$/.test(r?.launchId)).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function saveRun(run: StoredRun): void {
  const rest = loadRuns().filter((r) => r.launchId !== run.launchId);
  localStorage.setItem(KEY, JSON.stringify([run, ...rest].slice(0, 50)));
}

export const fromExecution = (e: Execution): StoredRun => ({
  launchId: e.launchId,
  demoId: e.demoId,
  createdAt: e.createdAt,
  status: e.status,
  conclusion: e.conclusion,
});

export const activeRun = (): StoredRun | undefined => loadRuns().find((r) => r.status !== "completed");
export const introSeen = () => localStorage.getItem(FIRST) === "1";
export const markIntroSeen = () => localStorage.setItem(FIRST, "1");
