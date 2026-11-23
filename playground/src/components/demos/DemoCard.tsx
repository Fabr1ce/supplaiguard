import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { Demo } from "../../types/demo";
import type { StoredRun } from "../../types/execution";
import { outcome } from "../../services/format";
import StatusIndicator from "../execution/StatusIndicator";
import VulnerabilityBadge from "./VulnerabilityBadge";
import LaunchButton from "./LaunchButton";

const ORDER = ["critical", "high", "medium", "low"];

export default function DemoCard({ demo, last, onLaunch, launching, blocked, unavailable }: { demo: Demo; last?: StoredRun; onLaunch: (id: string) => void; launching: boolean; blocked: string | null; unavailable?: string | null }) {
  const [open, setOpen] = useState(false);
  const findings = demo.findings ?? [];
  const bySeverity = demo.bySeverity ?? {};
  const rules = [...new Set(findings.map((f) => f.ruleId).filter(Boolean))];
  const deps = findings.filter((f) => f.type === "vulnerable_dependency");
  const isPrivate = demo.private === true;
  const note = unavailable ?? blocked;
  const state = last ? outcome(last.status, last.conclusion) : "ready";

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass glass-edge flex flex-col gap-4 p-5 transition-colors" aria-labelledby={`d-${demo.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id={`d-${demo.id}`} className="text-lg font-semibold">{demo.name}</h3>
          <p className="mt-0.5 text-xs text-green">{isPrivate ? "Private repository · Results only" : (demo.categories ?? []).join(" · ")}</p>
        </div>
        <StatusIndicator outcome={state} />
      </div>

      <p className="text-sm text-mute">{demo.description}</p>

      {isPrivate ? (
        <p className="text-xs text-mute">Runs in its own GitHub Actions. The run link is private, so you will see the results on this site instead.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Findings by severity">
          <span className="text-sm font-medium">{findings.length} {findings.length === 1 ? "finding" : "findings"}</span>
          {ORDER.filter((s) => bySeverity[s]).map((s) => (
            <VulnerabilityBadge key={s} severity={s}>{bySeverity[s]} {s}</VulnerabilityBadge>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <p className="font-mono text-xs text-mute">{rules.join(" ")}{deps.length ? ` + ${deps.length} dependency` : ""}</p>
      )}

      {!isPrivate && <div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-sm text-purple hover:text-ink">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          Scanner findings and why they matter
        </button>
        {open && (
          <ul className="mt-3 space-y-2 text-sm">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <VulnerabilityBadge severity={f.severity} />
                  <span className="font-mono text-xs">{f.ruleId || "dependency"}</span>
                  <span className="font-medium">{f.component}</span>
                  {f.type === "vulnerable_dependency" && <span className="text-xs text-mute">{f.currentVersion} · {f.advisories} advisories</span>}
                </div>
                <p className="mt-1 font-mono text-xs text-mute">{f.source}</p>
                {f.why && <p className="mt-1 text-mute">{f.why}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>}

      <div className="mt-auto space-y-2">
        <LaunchButton onClick={() => onLaunch(demo.id)} loading={launching} disabled={note !== null && note !== undefined} />
        {note && <p className="text-xs text-warn">{note}</p>}
        {last && <Link to={`/run/${last.launchId}`} className="block text-center text-xs text-green hover:underline">View last run</Link>}
      </div>
    </motion.article>
  );
}
