import { useEffect, useRef, useState } from "react";
import { ApiError, getStatus } from "../services/api";
import { fromExecution, saveRun } from "../services/storage";
import { simulateExecution } from "../services/simulate";
import type { Execution } from "../types/execution";

/** Dev-only preview options (`?demo=sim&end=failure&fix=1`). Always null in production builds. */
export interface SimOptions { end: string; fix: boolean }

/** Polls the Worker until the run is completed, then stops. Pauses while the tab is hidden. */
export function useExecution(id: string | undefined, sim: SimOptions | null = null) {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    if (!id || !(import.meta.env.DEV && sim)) return;
    const t0 = Date.now();
    const step = () => setExecution(simulateExecution((Date.now() - t0) / 1000, sim.end, sim.fix, id));
    step();
    const iv = setInterval(step, 1000);
    return () => clearInterval(iv);
  }, [id, sim?.end, sim?.fix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id || (import.meta.env.DEV && sim)) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stop) return;
      if (document.hidden) {
        timer = setTimeout(tick, 3000);
        return;
      }
      try {
        const e = await getStatus(id);
        if (stop) return;
        failures.current = 0;
        setError(null);
        setExecution(e);
        saveRun(fromExecution(e));
        if (e.status === "completed") return; // terminal: stop polling
        timer = setTimeout(tick, e.status === "queued" ? 4000 : 6000);
      } catch (err) {
        if (stop) return;
        const e = err as ApiError;
        setError(e);
        if (e.status === 404 || e.status === 400) return; // unknown id: retrying will not help
        failures.current += 1;
        timer = setTimeout(tick, Math.min(30000, 4000 * 2 ** failures.current));
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { execution, error };
}
