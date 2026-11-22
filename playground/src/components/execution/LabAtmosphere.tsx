import type { CSSProperties } from "react";

export type LabMode = "active" | "alive" | "cold";

/**
 * Fixed background layer behind the page: a purple and green glow, and forked bolts while a run is active.
 * Decorative only: aria-hidden, pointer-events none, behind all content, low opacity. Pure CSS animation, no timers.
 * Each bolt flashes once per 8 to 20 seconds, so the page never flashes more than 3 times per second.
 * With prefers-reduced-motion the global rule in index.css stops every animation and only the static glow remains.
 * `intensity` (0 to 1) raises the glow and shortens the gaps between bolts.
 */
export default function LabAtmosphere({ mode, intensity }: { mode: LabMode; intensity: number }) {
  const i = Math.min(1, Math.max(0, intensity));
  const period = 20 - 12 * i; // 20s calm down to 8s at full storm
  const vars = (delay: number, mult: number, peak: number) =>
    ({ "--lab-period": `${(period * mult).toFixed(1)}s`, "--lab-delay": `${delay}s`, "--lab-peak": peak }) as CSSProperties;

  if (mode === "cold") {
    return (
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" data-lab="cold">
        <div className="absolute inset-0" style={{ background: "radial-gradient(60rem 30rem at 50% -10%, rgb(120 130 160 / 0.10), transparent 60%)" }} />
      </div>
    );
  }
  const base = mode === "alive" ? 0.7 : 0.25 + 0.4 * i;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" data-lab={mode}>
      <div
        className={mode === "active" ? "lab-flash absolute inset-0" : "absolute inset-0"}
        style={{
          ...vars(0, 1, 0.5), ["--lab-base" as string]: base,
          background: mode === "alive"
            ? "radial-gradient(55rem 32rem at 50% -8%, rgb(143 211 107 / 0.28), transparent 62%), radial-gradient(40rem 26rem at 90% 0%, rgb(162 101 255 / 0.2), transparent 60%)"
            : "radial-gradient(55rem 30rem at 15% -10%, rgb(162 101 255 / 0.22), transparent 62%), radial-gradient(45rem 26rem at 92% 0%, rgb(143 211 107 / 0.16), transparent 60%)",
        } as CSSProperties}
      />
      {mode === "alive" && <div className="lab-alive absolute inset-0" style={{ opacity: 0.28, background: "radial-gradient(50rem 30rem at 50% 0%, rgb(143 211 107 / 0.45), transparent 65%)" }} />}
      {mode === "active" && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMin slice" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g className="lab-bolt" style={vars(1, 1, 0.55)} stroke="#a265ff" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <path d="M18 0 L15 9 L20 15 L13 26 L18 31 L10 44" vectorEffect="non-scaling-stroke" />
            <path d="M20 15 L28 22 L26 30" vectorEffect="non-scaling-stroke" />
          </g>
          <g className="lab-bolt" style={vars(5, 1.45, 0.45)} stroke="#8fd36b" strokeWidth="2">
            <path d="M84 0 L87 8 L81 16 L86 24 L79 36" vectorEffect="non-scaling-stroke" />
            <path d="M81 16 L74 21 L76 28" vectorEffect="non-scaling-stroke" />
          </g>
          <g className="lab-bolt" style={vars(9, 1.9, 0.35)} stroke="#ece8f5" strokeWidth="1.5">
            <path d="M52 0 L50 7 L55 12 L51 20 L54 27" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
      )}
    </div>
  );
}
