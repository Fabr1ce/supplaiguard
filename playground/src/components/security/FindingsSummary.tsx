import type { Results } from "../../types/execution";
import VulnerabilityBadge from "../demos/VulnerabilityBadge";

export default function FindingsSummary({ r }: { r: Results }) {
  const rules = [...new Set(r.findings.map((f) => f.ruleId).filter(Boolean))];
  return (
    <section className="glass p-5" aria-labelledby="fs">
      <h2 id="fs" className="text-lg font-semibold">Security findings</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-3xl font-semibold">{r.findings.length}</span>
        <span className="text-mute">findings from the deterministic scanner{r.scannerVersion ? ` v${r.scannerVersion}` : ""}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {["critical", "high", "medium", "low"].filter((s) => r.bySeverity[s]).map((s) => (
          <VulnerabilityBadge key={s} severity={s}>{r.bySeverity[s]} {s}</VulnerabilityBadge>
        ))}
      </div>
      {rules.length > 0 && <p className="mt-3 font-mono text-xs text-mute">Rules: {rules.join(", ")}</p>}
    </section>
  );
}
