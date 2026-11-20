import type { Demo } from "../../types/demo";
import type { StoredRun } from "../../types/execution";
import DemoCard from "./DemoCard";

export default function DemoGrid({ demos, runs, launchingId, onLaunch, blocked }: { demos: Demo[]; runs: StoredRun[]; launchingId: string | null; onLaunch: (id: string) => void; blocked: string | null }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {demos.map((d) => (
        <DemoCard key={d.id} demo={d} last={runs.find((r) => r.demoId === d.id)} onLaunch={onLaunch} launching={launchingId === d.id} blocked={launchingId && launchingId !== d.id ? "Another launch is starting…" : blocked} />
      ))}
    </div>
  );
}
