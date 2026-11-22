# SupplAIGuard Documentation

These pages describe how SupplAIGuard is built and how a run moves from a scan to a reviewed fix. They are derived from the code, workflows and specs in this repository. Anything that has never run live is marked as such, and [Status](status.md) lists the evidence for each claim.

| Page | Read it to learn |
|---|---|
| [Architecture](architecture.md) | The components, the trust boundaries, and how data moves between them. |
| [Flow](flow.md) | An end to end walkthrough: who triggers each step, which token it has, and what it produces. |
| [Security Model](security-model.md) | What is treated as untrusted, the OWASP agentic mapping, permissions per workflow, and what is never done. |
| [Operations](operations.md) | The setup checklist, how to run each workflow and the CLI, and troubleshooting. |
| [Status](status.md) | What is tested, what is implemented but never run live, and what is only planned. |

## The Loop In One Paragraph

Every run follows **Discover, Analyze, Remediate, Verify, Learn**. A deterministic Python scanner (`scanner/sg_scan.py`) does the exact checks: dependency advisories from OSV.dev and rule matches on MCP configs, agent definitions and skills. Kiro agents sit on top to connect findings, triage and propose fixes. A person approves every write and every merge. A finding counts as resolved only when a re-scan no longer reports it.

## Where Things Live

| Path | Contents |
|---|---|
| `.kiro/agents/` | Six Kiro agents (JSON) and their prompts in `.kiro/agents/prompts/`. |
| `.kiro/skills/` | Six skills the agents follow. |
| `.kiro/steering/` | The security policy, severity and confidence scoring, and the rule catalog. |
| `.kiro/hooks/` | Three local automation hooks. |
| `.kiro/specs/` | Requirements, design and tasks for each feature. |
| `scanner/` | The deterministic scanner, its helpers and the tests. |
| `.github/workflows/` | The CI workflows. |
| `examples/` | Workflows for repositories that consume SupplAIGuard. |
| `demo/` | Four intentionally vulnerable demo projects. |
| `playground/` | The React page and the Cloudflare Worker that launches demo runs. |
| `install.sh` | Installs the agents and policies into `~/.kiro` so they run from any repository. |

Back to the [project README](../README.md).
