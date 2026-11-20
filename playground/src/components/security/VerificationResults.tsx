import { ShieldQuestion } from "lucide-react";
import type { Results } from "../../types/execution";

export default function VerificationResults({ r }: { r: Results }) {
  return (
    <section className="glass p-5" aria-labelledby="vr">
      <h2 id="vr" className="text-lg font-semibold">Verification</h2>
      <div className="mt-3 flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 h-6 w-6 text-mute" aria-hidden />
        <div className="text-sm">
          <p className="font-medium">Not run</p>
          <p className="mt-1 text-mute">
            A finished GitHub Actions run does not mean a vulnerability was fixed. SupplAIGuard marks a finding resolved only after
            the Verification agent re-runs the scanner on a changed repository and the finding is gone. This workflow makes no change,
            so all {r.findings.length} findings remain open.
          </p>
          <p className="mt-2 text-xs text-mute">Possible verification outcomes in the full workflow: PASS, FAIL, NEEDS_REVIEW, INCOMPLETE.</p>
        </div>
      </div>
    </section>
  );
}
