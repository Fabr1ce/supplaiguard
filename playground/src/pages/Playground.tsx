import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, Radar, ShieldCheck, Sparkles, X } from "lucide-react";
import demos from "../data/demos.json";
import type { Demo } from "../types/demo";
import DemoGrid from "../components/demos/DemoGrid";
import { ApiError, apiConfigured, launchDemo } from "../services/api";
import { activeRun, fromExecution, introSeen, loadRuns, markIntroSeen, saveRun } from "../services/storage";

export default function Playground() {
  const nav = useNavigate();
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(!introSeen());
  const runs = useMemo(loadRuns, []);
  const active = activeRun();

  const onLaunch = async (demoId: string) => {
    if (launching) return; // duplicate-launch guard
    setError(null);
    setLaunching(demoId);
    try {
      const r = await launchDemo(demoId);
      const now = new Date().toISOString();
      saveRun({ launchId: r.launchId, demoId, createdAt: now, status: "queued", conclusion: null });
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
        <p className="text-sm text-cyan">SupplAIGuard Security Playground</p>
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
          <button type="button" className="text-cyan hover:underline" onClick={() => nav(`/run/${active.launchId}`)}>Open it</button>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-bad/50 bg-bad/10 p-4 text-sm text-bad">{error}</div>}

      <section aria-labelledby="demos">
        <h2 id="demos" className="mb-4 text-xl font-semibold">Choose a demo</h2>
        <DemoGrid demos={demos as Demo[]} runs={runs} launchingId={launching} onLaunch={onLaunch} blocked={blocked} />
      </section>

      <section id="how" aria-labelledby="how-h" className="scroll-mt-20">
        <h2 id="how-h" className="mb-4 text-xl font-semibold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { Icon: Radar, t: "1. Scan", d: "The deterministic scanner checks dependencies against OSV.dev and MCP configs and agent files against fixed rules. Same input, same result." },
            { Icon: Eye, t: "2. Analyze", d: "A Kiro agent, read-only and without shell access, connects findings across files and says what it could not determine." },
            { Icon: ShieldCheck, t: "3. Read the results", d: "You see the real findings. A run that finishes does not mean anything was fixed: this workflow changes no code." },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="glass p-5">
              <Icon className="h-6 w-6 text-violet" aria-hidden />
              <h3 className="mt-2 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-mute">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2 text-sm text-mute"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
          The full SupplAIGuard loop (propose a fix, approve it, re-scan to verify) needs a developer's approval and is not started from this page.</p>
      </section>
    </div>
  );
}
