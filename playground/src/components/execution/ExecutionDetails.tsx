import { useEffect, useState } from "react";
import type { Execution } from "../../types/execution";
import { duration, time } from "../../services/format";

export default function ExecutionDetails({ e, privateRepo = false }: { e: Execution; privateRepo?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (e.status === "completed") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [e.status]);
  const rows: [string, string][] = [
    ["Repository", privateRepo ? "Private repository" : "Fabr1ce/supplaiguard"],
    ["Workflow", e.workflow],
    ["Branch", e.branch],
    ["Run ID", e.runId ? String(e.runId) : "Waiting for GitHub"],
    ["Launched", time(e.createdAt)],
    ["Started", time(e.startedAt)],
    ["Completed", time(e.completedAt)],
    ["Duration", duration(e.startedAt, e.completedAt, now)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
          <dt className="text-mute">{k}</dt>
          <dd className="text-right font-mono text-xs">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
