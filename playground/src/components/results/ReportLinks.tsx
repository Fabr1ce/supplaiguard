import { Download, ExternalLink, FileText } from "lucide-react";
import type { Results } from "../../types/execution";
import { findingsMarkdown } from "../../services/format";

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-violet";

export default function ReportLinks({ r }: { r: Results }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a className={btn} href={r.runUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /> GitHub Actions run</a>
      <a className={btn} href="https://fabr1ce.github.io/supplaiguard/" target="_blank" rel="noreferrer"><FileText className="h-4 w-4" aria-hidden /> Full HTML report</a>
      <button className={btn} type="button" onClick={() => download(`${r.demoId}-findings.json`, "application/json", JSON.stringify({ scanId: r.scanId, findings: r.findings }, null, 2))}><Download className="h-4 w-4" aria-hidden /> Findings JSON</button>
      <button className={btn} type="button" onClick={() => download(`${r.demoId}-summary.md`, "text/markdown", findingsMarkdown(r.demoId, r.runUrl, r.findings))}><Download className="h-4 w-4" aria-hidden /> Markdown summary</button>
    </div>
  );
}
