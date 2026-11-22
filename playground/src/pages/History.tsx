import { useMemo } from "react";
import ExecutionHistory from "../components/history/ExecutionHistory";
import { loadRuns } from "../services/storage";

export default function History() {
  const runs = useMemo(loadRuns, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Execution history</h1>
      <p className="text-sm text-mute">Stored in this browser only. Share a result with its link: every execution page URL works on any device while the run's results are retained.</p>
      <ExecutionHistory runs={runs} />
    </div>
  );
}
