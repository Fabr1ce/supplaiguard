import { ExternalLink } from "lucide-react";
import type { FixOutcome } from "../../types/execution";
import { describeFix } from "../../services/fix";

/** Shown only for runs that asked for remediation. Text from the agent is never rendered here. */
export default function FixOutcomeCard({ fix, runUrl }: { fix: FixOutcome; runUrl: string }) {
  const v = describeFix(fix);
  return (
    <section className="glass p-5" aria-labelledby="fx">
      <h2 id="fx" className="text-lg font-semibold">Proposed fix (draft pull request)</h2>
      <p className="mt-2 text-sm">{v.headline}</p>
      {v.lines.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">{v.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {fix.prUrl && <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-purple" href={fix.prUrl} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" aria-hidden /> Open the draft pull request</a>}
        <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-purple" href={runUrl} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" aria-hidden /> Run and its artifacts</a>
      </div>
    </section>
  );
}
