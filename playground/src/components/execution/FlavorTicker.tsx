import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { pickFlavor, statusLine, type FlavorStatus, type StepKey } from "../../services/flavor";

const ROTATE_MS = 5000; // inside the 4 to 6 second range

/** Electrodes with a slowly travelling arc between them. The arc moves, it does not blink. */
function Arc({ live }: { live: boolean }) {
  return (
    <svg viewBox="0 0 120 16" className="h-4 w-28 shrink-0" aria-hidden fill="none">
      <circle cx="6" cy="8" r="3.5" fill="#a9a2bd" />
      <circle cx="114" cy="8" r="3.5" fill="#a9a2bd" />
      <path d="M10 8 L24 4 L36 12 L50 5 L64 11 L78 4 L92 12 L110 8" stroke={live ? "#8fd36b" : "#2a2440"} strokeWidth="1.5" strokeLinejoin="round" className={live ? "lab-arc" : undefined} opacity={live ? 0.9 : 1} />
    </svg>
  );
}

/**
 * Rotating flavour line plus the real status. Only the real status is exposed to assistive tech
 * (role="status", polite). The flavour line is aria-hidden so it never spams screen readers.
 * `done` lists steps that really finished successfully: a one-time "step complete" line is shown only for those.
 */
export default function FlavorTicker({ stepKey, status, done }: { stepKey: StepKey | "run"; status: FlavorStatus; done: StepKey[] }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [doneLine, setDoneLine] = useState<StepKey | null>(null);
  const prev = useRef<string>(stepKey);
  const running = status === "running";

  useEffect(() => {
    const before = prev.current as StepKey;
    prev.current = stepKey;
    setTick(0);
    setDoneLine(before !== stepKey && running && done.includes(before) ? before : null);
  }, [stepKey, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return; // terminal states show one fixed line
    const iv = setInterval(() => { setDoneLine(null); setTick((t) => t + 1); }, ROTATE_MS);
    return () => clearInterval(iv);
  }, [running, stepKey]);

  const line = doneLine ? pickFlavor(doneLine, "complete", 0) : pickFlavor(stepKey, status, tick);
  const real = statusLine(stepKey, status);
  const tone = status === "success" ? "text-green" : running ? "text-ink" : "text-mute";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Arc live={running && !reduce} />
      <div className="min-h-[3rem] min-w-0 flex-1">
        <div className={`min-h-[1.5rem] text-base italic ${tone}`} aria-hidden>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={line} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: reduce ? 0 : 0.6 }}>
              {line}
            </motion.p>
          </AnimatePresence>
        </div>
        <p role="status" aria-live="polite" className="min-h-[1.25rem] font-mono text-xs text-mute">{real}</p>
      </div>
    </div>
  );
}
