---
inclusion: always
---

# AI-Component Security Rules (Deterministic Catalog)

Authoritative deterministic rule catalog for MCP configurations and agent
definitions. The `sg-ai-component-rules` skill and the Threat Analysis agent
reference these rules by `rule_id`. Each finding emitted for an AI component MUST
carry the matched `rule_id`, the `evidence` (the offending excerpt), the
`finding type`, and a human-readable explanation.

Default severities below use `severity-and-confidence.md`. Confidence is `high`
for exact literal matches and `medium` for pattern/heuristic matches.

## MCP configuration rules → `insecure_mcp_configuration`

| rule_id | Match condition | Default severity | Explanation |
|---|---|---|---|
| `MCP-001` | An MCP server entry auto-approves all tools (e.g. `autoApprove`/trust set to `"*"` or `true` for every tool) | high | Wildcard auto-approval removes the human-in-the-loop guard; any tool the server exposes runs without prompting. |
| `MCP-002` | An MCP server disables tool prompting globally (e.g. a blanket "trust all" flag) | high | Equivalent to MCP-001; defeats permission gating. |
| `MCP-003` | An MCP server command is an **unpinned** remote package (e.g. `npx -y <pkg>` with no version, or `@latest`) | medium | Unpinned remote code can change under you; a compromised upstream executes locally. → may also raise `insecure_integration_configuration`. |
| `MCP-004` | An MCP server endpoint uses plaintext `http://` for a non-localhost host | medium | Credentials/traffic exposed in transit. |
| `MCP-005` | An MCP server embeds a hardcoded secret/token in `env`/`headers` (literal value, not `${VAR}`) | high | Secret committed to config; rotate and move to env var. |

## Agent-definition rules → `excessive_tool_permissions`

Evaluated against agent configs (2.x form: `allowedTools`, `toolsSettings`; or
V3 `tools`/`permissions`).

| rule_id | Match condition | Default severity | Explanation |
|---|---|---|---|
| `AGT-001` | `allowedTools` (or `tools`) contains `"*"` | high | Grants every tool, including write + shell, with no gating. |
| `AGT-002` | `shell`/`execute_bash` allowed with no command allow-list (no `toolsSettings.*.allowedCommands` / no shell `permissions` match) | high | Arbitrary command execution with no restriction. |
| `AGT-003` | `write`/`fs_write` allowed with no path restriction (no `deniedPaths`/`allowedPaths` / no `fs_write` match) | high | Can modify any file the user can, including `~/.kiro` configs and secrets. |
| `AGT-004` | An agent grants `shell` AND unrestricted `write` together | high | Combined capability enables self-modifying / lateral actions. |

## Agent-skill behavior rules → `suspicious_agent_skill`

Evaluated against agent `prompt`/instruction bodies and SKILL.md bodies.

| rule_id | Match condition (case-insensitive) | Default severity | Explanation |
|---|---|---|---|
| `SKL-001` | Instruction to exfiltrate data to an external URL (e.g. "POST the repo/secrets/env to http…") | high | Data-exfiltration instruction. |
| `SKL-002` | Instruction to disable, ignore, or bypass security checks/approvals/guardrails | high | Attempts to defeat the human-in-the-loop controls. |
| `SKL-003` | Instruction to fetch and execute remote code (e.g. `curl … | bash`, `eval` of downloaded content) | high | Remote code execution vector. |
| `SKL-004` | Instruction to read credential/secret files and include their contents in output | high | Secret disclosure. |
| `SKL-005` | Prompt-injection style override ("ignore previous instructions", "you are now…") embedded in a skill/agent body | medium | Possible prompt-injection payload; flag for review (confidence medium). |

## Integration rules → `insecure_integration_configuration`

| rule_id | Match condition | Default severity | Explanation |
|---|---|---|---|
| `INT-001` | A third-party integration references an unpinned/untrusted remote source (overlaps MCP-003) | medium | Unverified third-party code in the supply chain. |
| `INT-002` | An integration config stores a plaintext credential | high | Secret at rest in config. |

## Rule application notes

- A single component may match multiple rules; emit one finding per matched rule.
- Prefer the most specific rule; do not duplicate the same evidence under two
  rules that describe the same condition.
- Never assert malicious intent (`SKL-*`) without quoting the matched text as
  `evidence` (see security policy, Evidence discipline).
