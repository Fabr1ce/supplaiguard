import { useEffect, useRef, useState } from "react";
import { ApiError, getStatus } from "../services/api";
import { fromExecution, saveRun } from "../services/storage";
import type { Execution } from "../types/execution";

/** Polls the Worker until the run is completed, then stops. Pauses while the tab is hidden. */
export function useExecution(id: string | undefined) {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    if (!id) return;
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
  }, [id]);

  return { execution, error };
}
