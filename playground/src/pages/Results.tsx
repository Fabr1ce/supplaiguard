import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getResults } from "../services/api";
import type { Results as R } from "../types/execution";
import FindingsSummary from "../components/security/FindingsSummary";
import VulnerabilityCard from "../components/security/VulnerabilityCard";
import RemediationSummary from "../components/security/RemediationSummary";
import VerificationResults from "../components/security/VerificationResults";
import ResultSummary from "../components/results/ResultSummary";
import ReportLinks from "../components/results/ReportLinks";
import demos from "../data/demos.json";
import type { Demo } from "../types/demo";

export default function Results() {
  const { id = "" } = useParams();
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    getResults(id).then(setR).catch(setErr);
  }, [id]);

  if (err) {
    return (
      <div role="alert" className="glass mx-auto mt-10 max-w-xl p-6">
        <p className="font-medium">{err.status === 409 ? "The run has not finished yet." : "Results are not available."}</p>
        <p className="mt-1 text-sm text-mute">{err.message}</p>
        <Link to={`/run/${id}`} className="mt-3 inline-block text-green hover:underline">Back to the execution</Link>
      </div>
    );
  }
  if (!r) return <p className="mt-10 text-center text-mute">Loading results…</p>;
  const name = (demos as Demo[]).find((d) => d.id === r.demoId)?.name ?? r.demoId;

  return (
    <div className="space-y-5">
      <div>
        <Link to={`/run/${id}`} className="text-sm text-green hover:underline">← Execution</Link>
        <h1 className="mt-1 text-2xl font-semibold">{name}: security results</h1>
        <p className="font-mono text-xs text-mute">Execution {id}</p>
      </div>
      <ReportLinks r={r} />
      <div className="grid gap-5 md:grid-cols-2">
        <FindingsSummary r={r} />
        <VerificationResults r={r} />
      </div>
      <RemediationSummary r={r} />
      <section aria-labelledby="fl" className="glass p-5">
        <h2 id="fl" className="mb-3 text-lg font-semibold">Findings</h2>
        {r.findings.length ? <ul className="space-y-2">{r.findings.map((f) => <VulnerabilityCard key={f.id} f={f} />)}</ul> : <p className="text-sm text-mute">The scan reported no findings. If the scan did not finish, this page would say so; check the GitHub run.</p>}
      </section>
      <ResultSummary r={r} />
    </div>
  );
}
