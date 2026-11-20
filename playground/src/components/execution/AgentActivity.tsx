import type { Job } from "../../types/execution";

/** Real GitHub job and step names. Shown as-is so nothing is invented. */
export default function AgentActivity({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <p className="text-sm text-mute">No job data yet.</p>;
  return (
    <div className="space-y-3 text-sm">
      {jobs.map((j) => (
        <div key={j.name}>
          <p className="font-medium">{j.name} <span className="text-xs text-mute">{j.conclusion ?? j.status}</span></p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs text-mute">
            {j.steps.map((s) => (
              <li key={s.name}>{s.conclusion ?? s.status} · {s.name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
