import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Demo } from "../../types/demo";
import type { Execution } from "../../types/execution";
import { outcome } from "../../services/format";
import StatusIndicator from "./StatusIndicator";

export default function ExecutionHeader({ demo, execution, id }: { demo?: Demo; execution: Execution | null; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(location.href).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <header className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-cyan">{demo?.categories.join(" · ")}</p>
          <h1 className="text-2xl font-semibold">{demo?.name ?? execution?.demoId ?? "Execution"}</h1>
          <p className="mt-1 font-mono text-xs text-mute">Execution {id}</p>
        </div>
        <StatusIndicator outcome={execution ? outcome(execution.status, execution.conclusion) : "queued"} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {execution?.runUrl && (
          <a href={execution.runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-violet">
            <ExternalLink className="h-4 w-4" aria-hidden /> Open in GitHub Actions
          </a>
        )}
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-violet">
          {copied ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </header>
  );
}
