import { ExternalLink } from "lucide-react";
import type { PrivateResults } from "../../types/execution";
import { AGENT_SUMMARY_NOTE, PRIVATE_LINK_NOTE, describePrivate } from "../../services/privateDemo";
import { describePrivateFix } from "../../services/fix";

const SEV: [keyof PrivateResults["bySeverity"], string][] = [["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const TONE = { ok: "border-green/50", findings: "border-orange/50", incomplete: "border-bad/50 bg-bad/10" } as const;

/** Numbers, rule ids, severities and finding types. No path, evidence or file text is ever rendered here. */
export default function PrivateResultCard({ r }: { r: PrivateResults }) {
  const v = describePrivate(r);
  return (
    <div className="space-y-5">
      <section className={`glass border p-5 ${TONE[v.tone]}`} aria-labelledby="pv">
        <h2 id="pv" className="text-lg font-semibold">{v.headline}</h2>
        {v.lines.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">{v.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        <p className="mt-2 text-xs text-mute">Exit code {r.exitCode}: 0 clean, 1 findings, 2 scan errors or incomplete.</p>
      </section>
      {(r.status !== "incomplete" || r.findingsCount > 0) && (
        <section className="glass p-5" aria-labelledby="pv-sev">
          <h2 id="pv-sev" className="mb-3 text-lg font-semibold">Findings by severity</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SEV.map(([k, label]) => (
              <div key={k} className="rounded-xl border border-line p-3">
                <dt className="text-xs text-mute">{label}</dt>
                <dd className="text-2xl font-semibold">{r.bySeverity[k]}</dd>
              </div>
            ))}
          </dl>
          {v.types.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-medium">By finding type</h3>
              <ul className="space-y-1 text-sm">{v.types.map(([t, n]) => <li key={t} className="flex justify-between gap-3"><span>{t}</span><span className="font-mono">{n}</span></li>)}</ul>
            </>
          )}
          {v.rules.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-medium">By rule</h3>
              <ul className="space-y-1 text-sm">{v.rules.map(([id, n]) => <li key={id} className="flex justify-between gap-3"><span className="font-mono">{id}</span><span className="font-mono">{n}</span></li>)}</ul>
            </>
          )}
        </section>
      )}
      {r.fix && (() => {
        const fv = describePrivateFix(r.fix);
        return (
          <section className="glass p-5" aria-labelledby="pv-fix">
            <h2 id="pv-fix" className="text-lg font-semibold">Proposed fix (draft pull request)</h2>
            <p className="mt-2 text-sm">{fv.headline}</p>
            {fv.lines.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">{fv.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
            {r.fix.prUrl && (
              <a className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-purple" href={r.fix.prUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-4 w-4" aria-hidden /> Draft pull request (needs access)
              </a>
            )}
          </section>
        );
      })()}
      <section className="glass p-5 text-sm" aria-labelledby="pv-agent">
        <h2 id="pv-agent" className="text-lg font-semibold">Agent summary</h2>
        <p className="mt-1 text-mute">{AGENT_SUMMARY_NOTE}</p>
        <p className="mt-2 text-mute">{PRIVATE_LINK_NOTE}</p>
        <a className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-purple" href={r.runUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="h-4 w-4" aria-hidden /> Private run (needs access)
        </a>
      </section>
    </div>
  );
}
