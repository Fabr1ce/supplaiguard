import type { Results } from "../../types/execution";

export default function RemediationSummary({ r }: { r: Results }) {
  const ranOk = r.triage.exitCode === 0;
  return (
    <section className="glass p-5" aria-labelledby="rs">
      <h2 id="rs" className="text-lg font-semibold">What happened</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="text-mute">Identified by the scanner</dt><dd>{r.findings.length} findings{r.mcpConfigsDisabled !== null ? `; ${r.mcpConfigsDisabled} MCP config(s) were disabled in the agent's copy so they could not start.` : "."}</dd></div>
        <div><dt className="text-mute">Analyzed by Kiro</dt><dd>{r.triage.exitCode === null ? "The agent step did not run (no agent key is configured for this repository, or it was skipped)." : ranOk ? "The read-only threat-analysis agent completed. Its notes are below." : `The agent step ended with exit code ${r.triage.exitCode}.`}</dd></div>
        <div><dt className="text-mute">Changes proposed or applied</dt><dd>None. This workflow is read-only: no files were changed and no pull request was opened.</dd></div>
        <div><dt className="text-mute">Human approval</dt><dd>Not needed for this run. Any fix that changes dependencies or agent permissions needs developer approval in the full SupplAIGuard workflow.</dd></div>
      </dl>
    </section>
  );
}
