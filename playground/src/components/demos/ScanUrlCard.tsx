import { useState } from "react";
import { GitBranch } from "lucide-react";
import { checkRepoInput } from "../../services/scanUrl";

/** Shown only when the service says scanning by URL is on. Quick feedback only: the Worker validates again. */
export default function ScanUrlCard({ onLaunch, launching, blocked }: { onLaunch: (repo: string, ref: string | null) => void; launching: boolean; blocked: string | null }) {
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [touched, setTouched] = useState(false);
  const res = checkRepoInput(repo, ref);
  const repoError = touched && repo.trim() !== "" && !res.ok && res.field === "repo" ? res.message : null;
  const refError = ref.trim() !== "" && !res.ok && res.field === "ref" ? res.message : null;
  const canLaunch = repo.trim() !== "" && res.ok && !launching && !blocked;

  return (
    <section aria-labelledby="scan-url-h" className="glass p-5">
      <h2 id="scan-url-h" className="flex items-center gap-2 text-xl font-semibold"><GitBranch className="h-5 w-5 text-purple" aria-hidden /> Scan Your Own Repository</h2>
      <p className="mt-2 text-sm text-mute">
        Public GitHub repositories only. SupplAIGuard makes a shallow, read-only clone and scans it with the same deterministic scanner as the demos.
        Nothing from the repository is executed, installed or built, and no AI agent reads it. The scan runs as a GitHub Actions run in this project's
        repository, so the run and its report are visible on GitHub. URL scans are deterministic only; agent triage is available on the four demos. Rate limits apply: one scan per visitor per day, and one run at a time.
      </p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (canLaunch && res.ok) onLaunch(res.repo, res.ref);
        }}
      >
        <div className="sm:col-span-2">
          <label htmlFor="scan-url-repo" className="block text-sm font-medium">Repository</label>
          <input
            id="scan-url-repo"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={300}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="owner/repo or https://github.com/owner/repo"
            aria-invalid={repoError ? true : undefined}
            aria-describedby={repoError ? "scan-url-repo-err" : undefined}
            disabled={launching}
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm"
          />
          {repoError && <p id="scan-url-repo-err" role="alert" className="mt-1 text-sm text-bad">{repoError}</p>}
        </div>
        <div>
          <label htmlFor="scan-url-ref" className="block text-sm font-medium">Branch or tag <span className="text-mute">(optional)</span></label>
          <input
            id="scan-url-ref"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="default branch"
            aria-invalid={refError ? true : undefined}
            aria-describedby={refError ? "scan-url-ref-err" : undefined}
            disabled={launching}
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm"
          />
          {refError && <p id="scan-url-ref-err" role="alert" className="mt-1 text-sm text-bad">{refError}</p>}
        </div>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canLaunch} className="rounded-xl bg-purple px-4 py-2.5 text-sm font-semibold text-ground hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-50">
            {launching ? "Launching…" : "Scan this repository"}
          </button>
          {blocked && <span className="text-sm text-mute">{blocked}</span>}
        </div>
      </form>
    </section>
  );
}
