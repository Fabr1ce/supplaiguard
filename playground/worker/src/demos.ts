// The only demos a client can ask for. The client sends the id; everything else is decided here.
// Names match the `demo` choice in .github/workflows/demo-triage.yml.
export const DEMOS = {
  "vulnerable-ai-app": { workflowDemo: "vulnerable-ai-app" },
  "haunted-storyteller": { workflowDemo: "haunted-storyteller" },
  "crypt-keeper-mcp": { workflowDemo: "crypt-keeper-mcp" },
  "seance-gateway": { workflowDemo: "seance-gateway" },
} as const;

export type DemoId = keyof typeof DEMOS;

export function isDemoId(v: unknown): v is DemoId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DEMOS, v);
}

export const LAUNCH_ID_RE = /^pg-[0-9a-f]{12}$/;
