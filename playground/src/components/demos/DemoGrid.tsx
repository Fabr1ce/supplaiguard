import type { Demo } from "../../types/demo";
import type { StoredRun } from "../../types/execution";
import DemoCard from "./DemoCard";

/** Why a card cannot be launched regardless of other state. Only a private demo can be "not connected". */
export function unavailableNote(d: Demo, privateAvailable: boolean | null): string | null {
  if (d.private !== true) return null;
  if (privateAvailable === null) return "Checking whether this demo is connected…";
  return privateAvailable ? null : "Not connected yet";
}

export default function DemoGrid({ demos, runs, launchingId, onLaunch, blocked, privateAvailable = false }: { demos: Demo[]; runs: StoredRun[]; launchingId: string | null; onLaunch: (id: string) => void; blocked: string | null; /** null while /api/health is loading */ privateAvailable?: boolean | null }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {demos.map((d) => (
        <DemoCard key={d.id} demo={d} last={runs.find((r) => r.demoId === d.id)} onLaunch={onLaunch} launching={launchingId === d.id} blocked={launchingId && launchingId !== d.id ? "Another launch is starting…" : blocked} unavailable={unavailableNote(d, privateAvailable)} />
      ))}
    </div>
  );
}
