import { ExternalLink } from "lucide-react";
import type { ScanUrlResults } from "../../types/execution";
import { describeScan } from "../../services/scanUrl";

const SEV: [keyof ScanUrlResults["bySeverity"], string][] = [["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const TONE = { ok: "border-green/50", findings: "border-orange/50", incomplete: "border-bad/50 bg-bad/10" } as const;

/** Numbers, fixed text and one validated repository name. Nothing from the scanned repository is rendered. */
export default function ScanUrlResultCard({ r }: { r: ScanUrlResults }) {
  const v = describeScan(r);
  const repo = r.repository ?? `github.com/${r.scanUrl.repo}`;
  return (
    <div className="space-y-5">
      <section className={`glass border p-5 ${TONE[v.tone]}`} aria-labelledby="su">
        <h2 id="su" className="text-lg font-semibold">{v.headline}</h2>
        <p className="mt-1 font-mono text-sm">{repo}{r.scanUrl.ref ? ` (ref: ${r.scanUrl.ref})` : ""}</p>
        {v.lines.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">{v.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        <p className="mt-2 text-xs text-mute">Exit code {r.exitCode}: 0 clean, 1 findings, 2 scan errors or incomplete.</p>
      </section>
      {r.status !== "incomplete" || r.findingsCount > 0 ? (
        <section className="glass p-5" aria-labelledby="su-sev">
          <h2 id="su-sev" className="mb-3 text-lg font-semibold">Findings by severity</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SEV.map(([k, label]) => (
              <div key={k} className="rounded-xl border border-line p-3">
                <dt className="text-xs text-mute">{label}</dt>
                <dd className="text-2xl font-semibold">{r.bySeverity[k]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section className="glass p-5 text-sm" aria-labelledby="su-rep">
        <h2 id="su-rep" className="text-lg font-semibold">Full report</h2>
        <p className="mt-1 text-mute">
          The finding details, which come from the scanned repository, are not shown here. The full HTML report and findings.json are artifacts of the GitHub Actions run.
          Downloading an artifact needs a GitHub login and they expire after 14 days.
        </p>
        <a className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-purple" href={r.runUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="h-4 w-4" aria-hidden /> GitHub Actions run and report
        </a>
      </section>
    </div>
  );
}
