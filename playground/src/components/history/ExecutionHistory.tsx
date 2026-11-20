import { Link } from "react-router-dom";
import type { StoredRun } from "../../types/execution";
import { OUTCOME_LABEL, outcome, time } from "../../services/format";
import demos from "../../data/demos.json";
import type { Demo } from "../../types/demo";

export default function ExecutionHistory({ runs }: { runs: StoredRun[] }) {
  if (!runs.length) return <p className="text-mute">No executions in this browser yet.</p>;
  return (
    <div className="glass overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Executions started from this browser</caption>
        <thead className="text-xs text-mute">
          <tr><th className="p-3">Demo</th><th className="p-3">Execution</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3">Verification</th><th className="p-3"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.launchId} className="border-t border-line/60">
              <td className="p-3">{(demos as Demo[]).find((d) => d.id === r.demoId)?.name ?? r.demoId}</td>
              <td className="p-3 font-mono text-xs">{r.launchId}</td>
              <td className="p-3 text-mute">{time(r.createdAt)}</td>
              <td className="p-3">{OUTCOME_LABEL[outcome(r.status, r.conclusion)]}</td>
              <td className="p-3 text-mute">Not run</td>
              <td className="p-3"><Link className="text-cyan hover:underline" to={r.status === "completed" ? `/run/${r.launchId}/results` : `/run/${r.launchId}`}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
