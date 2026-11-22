import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, GitPullRequestDraft, GraduationCap, Radar, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import demos from "../data/demos.json";
import type { Demo } from "../types/demo";
import DemoGrid from "../components/demos/DemoGrid";
import ScanUrlCard from "../components/demos/ScanUrlCard";
import ProposeFixToggle from "../components/demos/ProposeFixToggle";
import { ApiError, apiConfigured, canProposeFix, canScanUrl, getHealth, launchDemo, launchRepo } from "../services/api";
import { activeRun, fromExecution, introSeen, loadRuns, markIntroSeen, saveRun } from "../services/storage";

export default function Playground() {
  const nav = useNavigate();
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixAvailable, setFixAvailable] = useState(false);
  const [scanUrlAvailable, setScanUrlAvailable] = useState(false); // off until /api/health says otherwise
  const [proposeFix, setProposeFix] = useState(false); // off by default, never remembered
  const [intro, setIntro] = useState(!introSeen());
  const runs = useMemo(loadRuns, []);
  const active = activeRun();

  useEffect(() => {
    if (apiConfigured) {
      getHealth()
        .then((h) => {
          setFixAvailable(canProposeFix(h));
          setScanUrlAvailable(canScanUrl(h));
        })
        .catch(() => {
          setFixAvailable(false);
          setScanUrlAvailable(false);
        });
    }
  }, []);

  const onLaunch = async (demoId: string) => {
    if (launching) return; // duplicate-launch guard
    setError(null);
    setLaunching(demoId);
    try {
      const r = await launchDemo(demoId, fixAvailable && proposeFix);
      const now = new Date().toISOString();
      saveRun({ launchId: r.launchId, demoId, createdAt: now, status: "queued", conclusion: null });
      nav(`/run/${r.launchId}`);
    } catch (e) {
      const err = e as ApiError;
      setError(err.retryAfter && err.status === 429 ? `${err.message} Try again in about ${Math.ceil(err.retryAfter / 60)} min.` : err.message);
      setLaunching(null);
    }
  };

  const onLaunchRepo = async (repo: string, ref: string | null) => {
    if (launching) return; // duplicate-launch guard
    setError(null);
    setLaunching("scan-url");
    try {
      const r = await launchRepo(repo, ref);
      saveRun({ launchId: r.launchId, demoId: "scan-url", createdAt: new Date().toISOString(), status: "queued", conclusion: null });
      nav(`/run/${r.launchId}`);
    } catch (e) {
      const err = e as ApiError;
      setError(err.retryAfter && err.status === 429 ? `${err.message} Try again in about ${Math.ceil(err.retryAfter / 60)} min.` : err.message);
      setLaunching(null);
    }
  };

  const blocked = !apiConfigured ? "The backend is not configured for this build." : active ? "You have a run in progress. Open it below." : null;

  return (
    <div className="space-y-10">
      <section className="pt-6 text-center">
        <img src={`${import.meta.env.BASE_URL}banner.gif`} width={800} height={400} alt="SupplAIGuard: a stitched green and purple ghost-shield inside a five-step loop" className="mx-auto mb-6 h-auto w-full max-w-[760px] rounded-2xl" />
        <p className="text-sm text-green">SupplAIGuard Security Playground</p>
        <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-2 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Watch AI <span className="shimmer">find it</span>. See what it <span className="shimmer">reports</span>.
        </motion.h1>
        <p className="mx-auto mt-4 max-w-2xl text-mute">
          Explore real security problems in AI-native apps. Launch a SupplAIGuard run, follow the deterministic scan and the
          Kiro agent's read-only analysis, and read the findings. Every number comes from the real scanner.
        </p>
      </section>

      {intro && (
        <aside className="glass relative p-5" aria-label="How to use the Playground">
          <button type="button" aria-label="Dismiss introduction" onClick={() => { markIntroSeen(); setIntro(false); }} className="absolute right-3 top-3 text-mute hover:text-ink"><X className="h-4 w-4" /></button>
          <p className="font-medium">First time here?</p>
          <p className="mt-1 text-sm text-mute">Pick a demo, press Launch, and stay on this page. It starts a real GitHub Actions run (usually a few minutes), shows its live steps, then shows the findings. Only one demo runs at a time.</p>
        </aside>
      )}

      {active && (
        <div className="glass flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <span>Run <span className="font-mono">{active.launchId}</span> is still going.</span>
          <button type="button" className="text-green hover:underline" onClick={() => nav(`/run/${active.launchId}`)}>Open it</button>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-bad/50 bg-bad/10 p-4 text-sm text-bad">{error}</div>}

      <section aria-labelledby="demos">
        <h2 id="demos" className="mb-4 text-xl font-semibold">Choose a demo</h2>
        {fixAvailable && <div className="mb-4"><ProposeFixToggle checked={proposeFix} onChange={setProposeFix} disabled={!!launching} /></div>}
        <DemoGrid demos={demos as Demo[]} runs={runs} launchingId={launching} onLaunch={onLaunch} blocked={blocked} />
      </section>

      {scanUrlAvailable && <ScanUrlCard onLaunch={onLaunchRepo} launching={launching === "scan-url"} blocked={launching && launching !== "scan-url" ? "Another launch is starting." : blocked} />}

      <section id="how" aria-labelledby="how-h" className="scroll-mt-20">
        <h2 id="how-h" className="mb-4 text-xl font-semibold">How it works</h2>
        <ol className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { Icon: Radar, t: "1. Scan", d: "The deterministic scanner checks dependencies against OSV.dev and MCP configs and agent files against fixed rules. Same input, same result." },
            { Icon: Eye, t: "2. Analyze", d: "A Kiro agent, read-only and without shell access, connects findings across files and says what it could not determine." },
            { Icon: ShieldCheck, t: "3. Read the results", d: "You see the real findings. A run that finishes does not mean anything was fixed: by default this workflow changes no code." },
            { Icon: GitPullRequestDraft, t: "4. Remediate", d: "Optional and off by default. The Remediation agent proposes the smallest fix on a copy of the demo, limited to manifests, agent and MCP config. A fixed check confirms nothing else changed, then a draft pull request opens. A person reviews it. Nothing merges automatically." },
            { Icon: RefreshCw, t: "5. Verify", d: "The changed copy is scanned again, and the draft pull request lists that re-check. Tests are not run, so a person still decides." },
            { Icon: GraduationCap, t: "6. Learn", d: "Opt-in only. After a person merges a fix, a sanitized report (rule ids, severities, counts, outcome; no source, secrets, paths or repository names) goes upstream as a pull request for a maintainer to review." },
          ].map(({ Icon, t, d }) => (
            <li key={t} className="glass p-5">
              <Icon className="h-6 w-6 text-purple" aria-hidden />
              <h3 className="mt-2 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-mute">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 text-sm text-mute"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-green" aria-hidden />
          When the service allows it, a separate card can also scan a public repository you name, with the scanner only. The full loop needs a developer's approval. When the service allows it, the toggle above can request a draft pull request for a person to review. It never merges anything, and reports never change rules by themselves.</p>
      </section>
    </div>
  );
}
