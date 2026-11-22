import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import demos from "../data/demos.json";
import type { Demo } from "../types/demo";
import { useExecution } from "../hooks/useExecution";
import ExecutionHeader from "../components/execution/ExecutionHeader";
import ExecutionDetails from "../components/execution/ExecutionDetails";
import WorkflowTimeline from "../components/execution/WorkflowTimeline";
import AgentActivity from "../components/execution/AgentActivity";
import LabAtmosphere, { type LabMode } from "../components/execution/LabAtmosphere";
import FlavorTicker from "../components/execution/FlavorTicker";
import { currentFlavor, doneKeys, intensityFor } from "../services/flavor";

export default function Execution() {
  const { id } = useParams();
  const nav = useNavigate();
  const [q] = useSearchParams();
  // Dev-only preview: #/run/x?demo=sim[&end=failure|cancelled][&fix=1]. Always null in production builds.
  const sim = import.meta.env.DEV && q.get("demo") === "sim" ? { end: q.get("end") ?? "success", fix: q.get("fix") === "1" } : null;
  const { execution, error } = useExecution(id, sim);
  const demo = (demos as Demo[]).find((d) => d.id === execution?.demoId);
  const done = execution?.status === "completed";

  useEffect(() => {
    if (done && execution?.conclusion === "success" && !sim) {
      const t = setTimeout(() => nav(`/run/${id}/results`), 2500);
      return () => clearTimeout(t);
    }
  }, [done, execution?.conclusion, id, nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const flavor = currentFlavor(execution?.status, execution?.conclusion, execution?.jobs ?? []);
  const mode: LabMode | null = !execution ? null : flavor.status === "success" ? "alive" : done ? "cold" : "active";

  if (error && !execution) {
    return (
      <div role="alert" className="glass mx-auto mt-10 max-w-xl p-6">
        <p className="font-medium">{error.status === 404 ? "This execution was not found." : "Could not load this execution."}</p>
        <p className="mt-1 text-sm text-mute">{error.message}</p>
        <Link to="/" className="mt-3 inline-block text-green hover:underline">Back to the Playground</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {mode && <LabAtmosphere mode={mode} intensity={intensityFor(flavor.key)} />}
      <ExecutionHeader demo={demo} execution={execution} id={id ?? ""} />
      {execution && (
        <div className="glass px-5 py-3">
          <FlavorTicker stepKey={flavor.key} status={flavor.status} done={doneKeys(execution.jobs)} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-warn">Connection problem: {error.message} Retrying…</p>}
      {execution?.conclusion === "failed_to_start" && (
        <p role="alert" className="rounded-xl border border-bad/50 bg-bad/10 p-4 text-sm text-bad">GitHub did not start a run for this launch. Nothing was executed. You can launch again.</p>
      )}
      <div className="grid gap-5 lg:grid-cols-5">
        <section className="glass p-5 lg:col-span-3" aria-labelledby="tl">
          <h2 id="tl" className="mb-3 text-lg font-semibold">Execution timeline</h2>
          <WorkflowTimeline jobs={execution?.jobs ?? []} started={execution?.status !== "queued" || (execution?.jobs.length ?? 0) > 0} />
        </section>
        <section className="glass p-5 lg:col-span-2" aria-labelledby="ed">
          <h2 id="ed" className="mb-3 text-lg font-semibold">Details</h2>
          {execution ? <ExecutionDetails e={execution} /> : <p className="text-sm text-mute">Loading…</p>}
        </section>
      </div>
      <details className="glass p-5">
        <summary className="cursor-pointer text-sm font-medium">Technical details: GitHub jobs and steps</summary>
        <div className="mt-3"><AgentActivity jobs={execution?.jobs ?? []} /></div>
      </details>
      {done && (
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/run/${id}/results`} className="rounded-xl bg-purple px-4 py-2.5 text-sm font-semibold text-ground hover:bg-purple/90">View security results</Link>
          {execution?.conclusion !== "success" && <span className="text-sm text-mute">The run did not finish successfully. Results may be missing.</span>}
        </div>
      )}
    </div>
  );
}
