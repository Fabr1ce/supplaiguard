# SupplAIGuard

**Autonomous security for AI-native applications.**
*Prevent locally. Detect continuously. Remediate intelligently. Verify automatically.*

SupplAIGuard protects the software supply chain of AI applications. Beyond
traditional dependency scanners, it analyzes AI-specific components — MCP server
configurations, agent definitions, and agent tool permissions — that
deterministic tools miss.

## Phase 1 (this MVP) — Kiro-native

Phase 1 is built **entirely from Kiro primitives** — no application code:

- **Agents** (`.kiro/agents/*.json`) — a Coordinator plus Discovery, Threat
  Analysis, Remediation, Verification, and an independent Reviewer.
- **Skills** (`.kiro/skills/*/SKILL.md`) — reusable procedures (npm inventory,
  OSV.dev scan, AI-component rules, findings schema, remediation, verification).
- **Steering** (`.kiro/steering/*.md`) — the governing security policies.
- **Hooks** (`.kiro/hooks/*.json`) — local automation.

Agents do their work with built-in tools (`read`, `write`, `shell`). The only
external call is to the public **OSV.dev** API for vulnerability intelligence.
No repository source leaves the machine — only package name+version coordinates.

> Runtime note: authored for and validated against **kiro-cli 1.21.0**. Agent
> configs use the 2.x schema (`allowedTools` + `toolsSettings`); hooks use the
> `version:"v1"` array form.

## The agents

| Agent | Role | Writes? |
|---|---|---|
| `supplaiguard-coordinator` | Orchestrates the lifecycle via sub-agent delegation | no |
| `supplaiguard-discovery` | Inventories deps, MCP configs, agent defs | no (read-only) |
| `supplaiguard-threat-analysis` | OSV.dev scan + AI-component rule checks → findings | no (shell = OSV only) |
| `supplaiguard-remediation` | Approval-gated fixes (scoped writes, denies secrets) | yes (gated) |
| `supplaiguard-verification` | Re-runs checks; resolves findings only if the check clears | no (shell = OSV only) |
| `supplaiguard-reviewer` | Independent post-task review on a **different model** | no (read-only) |

## Running a scan (local)

From a target repository (e.g. the bundled demo):

```bash
cd demo/vulnerable-ai-app
kiro-cli chat --agent supplaiguard-coordinator "Run a full SupplAIGuard scan."
```

The Coordinator runs: **discover → analyze → remediate (with your approval) →
verify**, then prints a consolidated report. Remediation only writes after you
approve, and a finding is `resolved` only after verification re-checks it.

## Automation hooks

- `analyze-on-manifest-change.json` — re-runs analysis when
  `package.json`/`package-lock.json`/`mcp.json`/agent configs are saved.
- `verify-after-remediation.json` — requests verification after a write.
- `review-after-task.json` — on task completion (`Stop`), launches the
  **reviewer agent on a different model** (`kiro-cli chat --agent
  supplaiguard-reviewer`) to cross-check the work. Asks before running and is
  fail-safe (never blocks or discards completed work).

## Demo repository

`demo/vulnerable-ai-app/` is deterministic and seeds:

- **Vulnerable dependency:** `lodash@4.17.4` (OSV advisories incl.
  `GHSA-29mw-wpgm-hmr9`; fixed in `4.17.21`).
- **Insecure MCP config** (`.kiro/settings/mcp.json`): wildcard `autoApprove`
  (rule MCP-001), unpinned `@latest` command (MCP-003), hardcoded secret
  (MCP-005).
- **Over-privileged agent** (`.kiro/agents/overprivileged.json`): `tools:["*"]`
  (AGT-001) and a bypass-safety instruction (SKL-002/005).

## Spec-driven development

This project is built spec-first. See:

- `.kiro/specs/supplaiguard/requirements.md` — EARS acceptance criteria.
- `.kiro/specs/supplaiguard/design.md` — architecture and component designs.
- `.kiro/specs/supplaiguard/tasks.md` — the implementation plan (traceable to
  requirements).
