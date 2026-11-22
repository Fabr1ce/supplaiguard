import { useState } from "react";
import type { Results } from "../../types/execution";

/** The agent's text is untrusted. It is rendered as plain text only, never as HTML or markdown. */
export default function ResultSummary({ r }: { r: Results }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="glass p-5" aria-labelledby="ts">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ts" className="text-lg font-semibold">Kiro agent triage notes</h2>
        <button type="button" className="text-sm text-purple hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (r.triage.text
        ? <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 font-mono text-xs leading-relaxed">{r.triage.text}</pre>
        : <p className="mt-3 text-sm text-mute">No agent output was saved for this run.</p>)}
      <p className="mt-2 text-xs text-mute">Agent output is generated text. Check it against the scanner findings.</p>
    </section>
  );
}
