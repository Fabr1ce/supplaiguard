export default function ProposeFixToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="glass p-4 text-sm">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-purple" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby="pf-help" />
        <span>
          <span className="font-medium">Also let the agent propose a fix <span className="text-orange">(experimental)</span></span>
          <span id="pf-help" className="mt-1 block text-mute">
            Off by default. If you turn it on, the Remediation agent edits a copy of the demo and the workflow opens a <strong>draft</strong> pull request.
            It only proposes: a fixed allow-list (dependency manifests and agent or MCP config) decides what may change, the scanner re-checks the result,
            and a person has to review the draft. Nothing is merged automatically. Limited to one per visitor per day.
          </span>
        </span>
      </label>
    </div>
  );
}
