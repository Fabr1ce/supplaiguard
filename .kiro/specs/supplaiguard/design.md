# Design — SupplAIGuard (Phase 1 / MVP)

## Overview

SupplAIGuard Phase 1 is a **Kiro-native, prompt-driven** security system. It is
assembled from Kiro configuration primitives only — no application code:

- **Agents** (`.kiro/agents/*.json`) — one Coordinator + four domain agents.
- **Skills** (`.kiro/skills/<name>/SKILL.md`) — the reusable procedures.
- **Steering** (`.kiro/steering/*.md`) — the governing security policies.
- **Hooks** (`.kiro/hooks/*.json`) — local automation triggers.

All runtime work is performed by **built-in tools** (`read`, `write`, `shell`).
The OSV.dev integration is a `curl` POST to the public batch API executed through
the `shell` tool. Findings flow between agents as a single JSON object conforming
to the shared schema.

This design maps directly to the requirements. Traceability is noted inline as
`(Rn.m)` referencing `requirements.md`.

## Architecture

### Component layout

```
.kiro/
├── agents/
│   ├── supplaiguard-coordinator.json     # entry point; delegates to sub-agents (R7)
│   ├── supplaiguard-discovery.json       # read-only inventory (R1)
│   ├── supplaiguard-threat-analysis.json # OSV.dev + AI-component rules (R2, R3)
│   ├── supplaiguard-remediation.json     # approval-gated fixes (R5)
│   └── supplaiguard-verification.json    # re-scan + report (R6)
│   └── supplaiguard-reviewer.json        # post-task review on a DIFFERENT model (R12)
├── skills/
│   ├── sg-npm-inventory/SKILL.md         # parse package.json / package-lock.json (R1, R8)
│   ├── sg-osv-dependency-scan/SKILL.md   # OSV.dev query + severity mapping (R2, R8)
│   ├── sg-ai-component-rules/SKILL.md     # MCP + agent-skill rule catalog (R3, R8)
│   ├── sg-findings-schema/SKILL.md        # the canonical schema contract (R4, R8)
│   ├── sg-remediation/SKILL.md            # safe-fix procedure (R5, R8)
│   └── sg-verification/SKILL.md           # re-scan + before/after report (R6, R8)
├── steering/
│   ├── security-policy.md                 # non-negotiable rules (R9) — always
│   ├── severity-and-confidence.md         # scoring rules (R9.3) — always
│   └── ai-component-security-rules.md     # deterministic rule catalog (R9.4) — always
├── hooks/
│   ├── analyze-on-manifest-change.json    # FileEdited/PostToolUse → analysis (R10.1)
│   ├── verify-after-remediation.json      # PostToolUse on writes → verify (R10.2)
│   └── review-after-task.json             # Stop → review sub-agent (different model) (R12)
└── specs/supplaiguard/                     # this spec

demo/vulnerable-ai-app/                     # predictable demo repo (R11)
├── package.json
├── package-lock.json
├── .kiro/settings/mcp.json                 # seeded insecure MCP config
└── .kiro/agents/overprivileged.json        # seeded excessive-permissions agent
```

> Note on steering modes: the Kiro steering doc supports `always`, `auto`,
> `fileMatch`, and `manual`. The three policy files use `always` so every agent
> inherits them. Custom agents also need the `skill://` and `file://` resources
> declared explicitly (custom agents do not auto-load skills).

### Data flow (local lifecycle)

```
Developer ──▶ Coordinator agent
                 │  (subagent: discovery)
                 ▼
            Discovery ──▶ inventory.json (deps, mcp servers, agent defs) (R1)
                 │  (subagent: threat-analysis)
                 ▼
          Threat Analysis ──▶ findings[] (vulnerable_dependency,
                 │             insecure_mcp_configuration, …) (R2,R3,R4)
                 │  (subagent: remediation — only if findings & approved)
                 ▼
            Remediation ──▶ applies fixes (fs_write = ask) + before/after (R5)
                 │  (subagent: verification)
                 ▼
          Verification ──▶ PASS/FAIL/NEEDS_REVIEW + before/after report (R6)
                 ▼
            Coordinator ──▶ consolidated report to developer (R7.4)
```

The findings object is the single contract passed between stages (R7.3). Agents
never redefine it; they load `sg-findings-schema` (R4.6).

## Agent designs

All agents use the CLI V3 / IDE 1.0 schema. Each sets `tools` (what it can see)
and `permissions.rules` (what those tools may do; `deny` wins). Each references
its skills and the steering via `resources`.

### Coordinator (`supplaiguard-coordinator.json`) — R7

- **Role:** orchestrate the lifecycle by delegating to sub-agents in order.
- **tools:** `["read", "subagent/supplaiguard-discovery", "subagent/supplaiguard-threat-analysis", "subagent/supplaiguard-remediation", "subagent/supplaiguard-verification"]`
- **permissions:** `subagent` → `allow` only the four named sub-agents (R7.5); no shell/write.
- **resources:** steering policy + `sg-findings-schema` (to validate hand-offs).
- **prompt:** run Discovery → Threat Analysis; if findings and the developer
  approves, run Remediation → Verification; then emit a consolidated report. Must
  not mutate the findings schema (R7.2, R7.3).

```json
{
  "name": "supplaiguard-coordinator",
  "description": "SupplAIGuard orchestrator. Runs the local security lifecycle: discover, analyze, remediate (with approval), verify. Use to run a full SupplAIGuard scan.",
  "tools": ["read", "subagent"],
  "permissions": {
    "rules": [
      { "capability": "subagent",
        "match": ["supplaiguard-discovery", "supplaiguard-threat-analysis", "supplaiguard-remediation", "supplaiguard-verification"],
        "effect": "allow" },
      { "capability": "fs_write", "match": ["**"], "effect": "deny" }
    ]
  },
  "resources": [
    "file://.kiro/steering/security-policy.md",
    "skill://.kiro/skills/sg-findings-schema/SKILL.md"
  ],
  "prompt": "file://./prompts/coordinator.md"
}
```

### Discovery (`supplaiguard-discovery.json`) — R1

- **Role:** read-only inventory of dependencies + AI components.
- **tools:** `["read"]` (and `shell` only for read-only listing if needed).
- **permissions:** `fs_write` → `deny` everywhere (R1.8); `fs_read` → `allow` workspace.
- **resources:** `sg-npm-inventory`, `sg-findings-schema`, steering.
- **Behavior:** parse `package-lock.json` (preferred) or `package.json`
  (unlocked/approximate), glob MCP configs and `.kiro/agents/*`, emit
  `inventory` object; record parse errors and continue (R1.7).

### Threat Analysis (`supplaiguard-threat-analysis.json`) — R2, R3

- **Role:** turn inventory into findings.
- **tools:** `["read", "shell"]` (shell for `curl` to OSV.dev).
- **permissions:** `shell` → `allow` only `curl https://api.osv.dev/*`;
  `fs_write` → `deny`. This narrow allow-list keeps the agent from arbitrary
  command execution (security best practice from docs).
- **resources:** `sg-osv-dependency-scan`, `sg-ai-component-rules`,
  `sg-findings-schema`, all three steering files.
- **Behavior:**
  - Dependency scan: batch POST package/version pairs to
    `https://api.osv.dev/v1/querybatch`, then `GET /v1/vulns/{id}` for fix
    versions; map to `vulnerable_dependency` findings; derive severity from
    CVSS/severity when present else `medium`/low-confidence (R2.1–R2.6).
    On API failure, report clearly — never emit false all-clear (R2.7).
  - AI-component scan: apply the deterministic rule catalog to MCP configs and
    agent definitions; emit `insecure_mcp_configuration`,
    `excessive_tool_permissions`, `suspicious_agent_skill`,
    `insecure_integration_configuration` with rule id + evidence (R3).

### Remediation (`supplaiguard-remediation.json`) — R5

- **Role:** propose and apply safe fixes with approval.
- **tools:** `["read", "write"]`.
- **permissions:** `fs_write` → effect **`ask`**, `match` scoped to manifests/config
  (e.g. `["**/package.json", "**/package-lock.json", "**/mcp.json", ".kiro/agents/**"]`);
  explicit `deny` on secrets/prod files (`[".env", "**/*secret*", "**/secrets/**"]`) (R5.3, steering R9.2).
- **resources:** `sg-remediation`, `sg-findings-schema`, steering.
- **Behavior:** for each `remediation_available` finding, compute a forward-only
  version bump (never downgrade to a vulnerable version — R5.5), write change,
  capture before/after (R5.6), explain rationale (R5.2). High-impact changes
  require explicit approval per steering (R5.7). Never merges (R5.4).

### Verification (`supplaiguard-verification.json`) — R6

- **Role:** prove findings are resolved by re-running checks.
- **tools:** `["read", "shell"]` (re-runs the same OSV/AI checks).
- **permissions:** `shell` → `allow` only `curl https://api.osv.dev/*`;
  `fs_write` → `deny` (R6.7).
- **resources:** `sg-verification`, `sg-osv-dependency-scan`,
  `sg-ai-component-rules`, `sg-findings-schema`, steering.
- **Behavior:** re-scan modified workspace; a finding is `PASS` only if the
  re-run no longer reports it (R6.2); detect regressions → overall FAIL/NEEDS_REVIEW
  (R6.5); produce before/after report keyed by finding `id` (R6.4, R6.6).

### Reviewer (`supplaiguard-reviewer.json`) — R12

- **Role:** independent, read-only post-task reviewer running on a **different
  model** than the primary working agent, invoked automatically by a `Stop` hook.
- **model:** pinned to a model distinct from the primary session's model
  (R12.1). The exact model ID is confirmed from `/model` during implementation;
  the design only requires it to differ from the primary agent's model.
- **tools:** `["read"]` (and `shell` only if a read-only diff command like
  `git diff` is needed).
- **permissions:** `fs_write` → `deny` everywhere (R12.5); the agent reports
  issues, never fixes them.
- **resources:** the spec (`requirements.md`, `design.md`, `tasks.md`), the
  steering policy, and `sg-findings-schema`, so the review is grounded in the
  acceptance criteria and policies (R12.4, R12.6).
- **Behavior:** inspect the changes made during the just-completed task (e.g. via
  `git diff`/recently modified files), then produce a structured review covering:
  (a) correctness vs. the relevant requirement acceptance criteria, (b) adherence
  to the steering security policy, (c) required follow-ups. Output is advisory and
  auditable.

**Why a separate agent is required for "different model":** the hook schema has
no model field. Model selection is an agent-level property (`model`). A `Stop`
hook `agent` action injects a prompt into the current loop; to guarantee the
review runs on a different model, the hook delegates to this reviewer sub-agent,
whose pinned `model` governs its own loop.

```json
{
  "name": "supplaiguard-reviewer",
  "description": "Independent post-task reviewer. Runs read-only on a different model to cross-check completed work against the spec and the SupplAIGuard security policy.",
  "model": "<model-id-different-from-primary>",
  "tools": ["read"],
  "permissions": {
    "rules": [
      { "capability": "fs_write", "match": ["**"], "effect": "deny" }
    ]
  },
  "resources": [
    "file://.kiro/specs/supplaiguard/requirements.md",
    "file://.kiro/specs/supplaiguard/design.md",
    "file://.kiro/specs/supplaiguard/tasks.md",
    "file://.kiro/steering/security-policy.md",
    "skill://.kiro/skills/sg-findings-schema/SKILL.md"
  ],
  "prompt": "file://./prompts/reviewer.md"
}
```


### Reviewer (`supplaiguard-reviewer.json`) — R12

- **Role:** independent, read-only post-task reviewer running on a **different
  model** than the primary working agent, invoked automatically by a `Stop` hook.
- **model:** pinned to a model distinct from the primary session's model
  (R12.1). The exact model ID is confirmed from `/model` during implementation;
  the design only requires it to differ from the primary agent's model.
- **tools:** `["read"]` (and `shell` only if a read-only diff command like
  `git diff` is needed).
- **permissions:** `fs_write` → `deny` everywhere (R12.5); the agent reports
  issues, never fixes them.
- **resources:** the spec (`requirements.md`, `design.md`, `tasks.md`), the
  steering policy, and `sg-findings-schema`, so the review is grounded in the
  acceptance criteria and policies (R12.4, R12.6).
- **Behavior:** inspect the changes made during the just-completed task (e.g. via
  `git diff`/recently modified files), then produce a structured review covering:
  (a) correctness vs. the relevant requirement acceptance criteria, (b) adherence
  to the steering security policy, (c) required follow-ups. Output is advisory and
  auditable.

**Why a separate agent is required for "different model":** the hook schema has
no model field. Model selection is an agent-level property (`model`). A `Stop`
hook `agent` action injects a prompt into the current loop; to guarantee the
review runs on a different model, the hook delegates to this reviewer sub-agent,
whose pinned `model` governs its own loop.

```json
{
  "name": "supplaiguard-reviewer",
  "description": "Independent post-task reviewer. Runs read-only on a different model to cross-check completed work against the spec and the SupplAIGuard security policy.",
  "model": "<model-id-different-from-primary>",
  "tools": ["read"],
  "permissions": {
    "rules": [
      { "capability": "fs_write", "match": ["**"], "effect": "deny" }
    ]
  },
  "resources": [
    "file://.kiro/specs/supplaiguard/requirements.md",
    "file://.kiro/specs/supplaiguard/design.md",
    "file://.kiro/specs/supplaiguard/tasks.md",
    "file://.kiro/steering/security-policy.md",
    "skill://.kiro/skills/sg-findings-schema/SKILL.md"
  ],
  "prompt": "file://./prompts/reviewer.md"
}
```


## Skills designs — R8

Each skill is `.kiro/skills/<name>/SKILL.md` with frontmatter (`name`,
`description`) and a markdown procedure body. Skills hold the detail; agents stay
lean (R8.4). Skills reference steering rather than restating policy (R8.5).

| Skill | Purpose | Key contents |
|---|---|---|
| `sg-npm-inventory` | Parse manifests | Lockfile schema (v1/v2/v3 `packages`/`dependencies`), extracting `{name, version, path}`; unlocked fallback; parse-error handling |
| `sg-osv-dependency-scan` | OSV.dev query | `querybatch` request shape, `ecosystem: "npm"`, pagination, fix-version extraction from `affected[].ranges`, CVSS→severity mapping |
| `sg-ai-component-rules` | AI rule catalog | Rule IDs + matchers for MCP (wildcard auto-approve, unpinned remote command) and agent defs (`tools:["*"]`, unrestricted `fs_write`/`shell`, suspicious instruction patterns) |
| `sg-findings-schema` | Schema contract | Canonical JSON schema, enums, required fields, a valid example, and a validation checklist |
| `sg-remediation` | Safe-fix procedure | Version-bump selection (lowest fixed ≥ current), MCP/agent config tightening, before/after capture, forbidden actions |
| `sg-verification` | Re-scan procedure | Which checks to re-run per finding type, PASS/FAIL/NEEDS_REVIEW rules, regression detection, report format |

### Findings schema (defined once in `sg-findings-schema`) — R4

```json
{
  "repository": "string",
  "scan_id": "string",
  "environment": "local | ci",
  "generated_at": "ISO-8601",
  "findings": [
    {
      "id": "SG-001",
      "type": "vulnerable_dependency | malicious_package_indicator | insecure_mcp_configuration | excessive_tool_permissions | suspicious_agent_skill | insecure_integration_configuration",
      "component": "string",
      "current_version": "string (deps only)",
      "recommended_version": "string (deps only)",
      "severity": "critical | high | medium | low",
      "confidence": "high | medium | low",
      "source": "file path",
      "rule_id": "string (AI-component findings)",
      "evidence": "string | object",
      "description": "string",
      "remediation_available": true,
      "status": "open | remediated | resolved | needs_review"
    }
  ]
}
```

## Steering designs — R9

- **`security-policy.md`** (mode: always) — the non-negotiables (R9.2):
  never auto-merge; never introduce unverified deps; never downgrade a security
  protection; never modify production secrets; human approval for high-impact;
  always verify remediation; all outputs structured/auditable (R9.5).
- **`severity-and-confidence.md`** (always) — CVSS→severity bands; confidence
  rules (high when OSV gives explicit severity + fix; medium default; low when
  heuristic) (R9.3).
- **`ai-component-security-rules.md`** (always) — the authoritative deterministic
  rule catalog used by `sg-ai-component-rules` and the Threat Analysis agent
  (R9.4). Single source of truth; the skill references it.

## Hooks designs — R10, R12

Standalone JSON files at `.kiro/hooks/*.json`. Each file has `version: "v1"` and a
`hooks` array. Triggers are PascalCase. Action type is `command` (runs a shell
command; stdout added to context on exit 0) or `agent` (injects a prompt that
starts a new agent loop).

- **`analyze-on-manifest-change.json`** — `PostFileSave` trigger with a `matcher`
  regex on manifest/config paths (`package\.json`, `package-lock\.json`,
  `mcp\.json`, `\.kiro/agents/`), `agent` action prompting a SupplAIGuard
  analysis via the Coordinator (analysis-only) (R10.1, R10.3).
- **`verify-after-remediation.json`** — `PostToolUse` trigger with a `matcher` on
  write tools (`^(fs_write|fs_append|str_replace)$`), `agent` action invoking
  Verification after a remediation edit (R10.2, R10.3).
- **`review-after-task.json`** — `Stop` trigger (fires when the assistant
  finishes a task/turn), `agent` action whose prompt delegates to the
  `supplaiguard-reviewer` sub-agent so the review runs on the reviewer's pinned
  (different) model (R12.2, R12.3). Optionally includes a `confirm` block so the
  developer controls when the review runs each turn (R12.8), and may set
  `enabled: false` to disable without deleting.
- Fail-safe (R10.4, R12.7): a hook non-zero exit surfaces STDERR as a warning and
  never suppresses findings or discards completed work; if the reviewer model is
  unavailable the warning is shown and the task result is preserved.

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "SupplAIGuard review after task",
      "trigger": "Stop",
      "action": {
        "type": "agent",
        "prompt": "Delegate to the supplaiguard-reviewer sub-agent (which runs on a different model). Have it review the changes from the task just completed against the relevant requirement acceptance criteria in .kiro/specs/supplaiguard/requirements.md and the .kiro/steering/security-policy.md, then report correctness, policy adherence, and any required follow-ups. Do not modify files."
      },
      "confirm": {
        "question": "Run the SupplAIGuard review agent (different model) on this task?",
        "options": [
          { "id": "review", "label": "Yes, review", "run": true },
          { "id": "skip", "label": "Skip", "run": false }
        ]
      }
    }
  ]
}
```

> Open validation items (tracked as tasks, confirm against `/docs/hooks/types`):
> 1. The exact trigger name for "file changed" — `PostFileSave` (documented in the
>    quick example) vs `PostToolUse` + write matcher. Design uses `PostFileSave`
>    for file-save intent and `PostToolUse` for tool-level gating.
> 2. Whether a `Stop` **agent** action can reliably route to a specific sub-agent
>    purely via prompt, or whether a `command` action (e.g. a headless
>    `kiro-cli` invocation of the reviewer agent) is the more deterministic way to
>    guarantee the different-model review. Task 1.4 resolves this; if the agent
>    action cannot pin the sub-agent/model, fall back to a `command` action that
>    launches the reviewer agent explicitly.

## Demo repository design — R11

`demo/vulnerable-ai-app/` is deterministic:

- `package.json` + `package-lock.json` pinning one **known-vulnerable** npm
  package at a specific version with a known OSV advisory and a known fixed
  version (so remediation + verification have a concrete target). Exact package
  chosen during implementation and confirmed against OSV.dev (task).
- `.kiro/settings/mcp.json` with an insecure MCP config (wildcard auto-approve).
- `.kiro/agents/overprivileged.json` declaring `tools: ["*"]` / unrestricted
  write+shell (excessive permissions).
- Supports the full lifecycle demo (R11.4).

## Error handling

- **OSV.dev failure (R2.7):** Threat Analysis reports `scan_error` and does not
  emit clean results; Coordinator surfaces the error and halts remediation.
- **Unparseable manifest (R1.7):** Discovery records a per-file parse error and
  continues.
- **Unapproved write (R5.3):** `fs_write` effect `ask` blocks until the developer
  approves; denial leaves files unchanged.
- **Hook failure (R10.4):** non-zero exit → STDERR warning; lifecycle remains
  manually runnable.
- **Schema violation (R4.7):** downstream agents treat malformed findings as an
  error rather than silently proceeding.

## Security considerations

- Least privilege per agent: read-only agents `deny` `fs_write`; shell is
  allow-listed to `curl https://api.osv.dev/*` only (no arbitrary execution).
- Remediation write scope is explicitly bounded and denies secret/prod paths.
- No repository source is uploaded anywhere; only package coordinates
  (name + version) are sent to OSV.dev. This preserves local privacy.
- Policies live in `always` steering so sub-agents inherit them, and sub-agent
  calls are additionally constrained by the parent (stricter wins).

## Testing strategy

- **Deterministic detection test:** run the Coordinator against
  `demo/vulnerable-ai-app/`; assert the seeded `vulnerable_dependency` and the
  seeded AI-component finding appear with correct types/severity (R3.7, R11.3).
- **Schema conformance:** validate emitted findings against the
  `sg-findings-schema` contract (R4.7).
- **Remediation gating:** confirm `fs_write` prompts (effect `ask`) and that a
  denial leaves files unchanged (R5.3).
- **Verification honesty:** apply a non-fixing edit and confirm the finding is
  NOT marked resolved (R6.2); apply the real fix and confirm `PASS` (R6.2).
- **Permission posture:** confirm read-only agents cannot write and that shell
  is restricted to the OSV host.
- **OSV failure path:** simulate network failure and confirm no false all-clear
  (R2.7).

---

# Phase 3 Design — CI Mode, Evolution Loop, Kiroween

Traceability: R13–R18 in `requirements.md`.

## Phase 2 as built (summary)

`scanner/sg_scan.py` (stdlib only) is the deterministic core; v3 agents run it first and
use the LLM for SKL-* semantics, triage and remediation. `install.sh` puts agents in
`~/.kiro/agents` and policies/skills/scanner in `~/.kiro/supplaiguard/`.

## Topology: three repos

```
 org repos (consumers)            supplaiguard (this repo, public)         supplaiguard-crew (separate public repo)
 ─────────────────────            ────────────────────────────────         ────────────────────────────────────────
 .github/workflows/sg.yml  ──uses@SHA──▶  .github/workflows/scan.yml (workflow_call)
        │                                  scanner/, .kiro/agents, skills, steering
        │  sanitized evolution report                     ▲
        └──────────── PR/issue via GitHub App ────────────┤
                                                          │ reviewed by
                                                          └────────────────  Kiro Crew "steward" (schedule + heartbeat + lessons)
```

- **Shared definition:** the reusable workflow and the agents live in one repo. In an org
  this is `<org>/supplaiguard` (or `<org>/.github`); consumers reference it with
  `uses: <org>/supplaiguard/.github/workflows/scan.yml@<full-commit-sha>`.
  Pinning by SHA is required (R15.2).
- **Why a separate Crew repo:** the Best Kiro Crew App bonus needs its own repo (R18.7).

## CI workflow (`scan.yml`, `on: workflow_call`)

Jobs, in order, each with minimal `permissions:`:

1. **scan** (`contents: read`): checkout the consumer repo, check out the pinned
   SupplAIGuard ref into `.sg/`, run `python3 .sg/scanner/sg_scan.py . --format json`.
   No secrets. Writes `findings.json`, a Markdown job summary, and an HTML report artifact.
   Exit code drives the gate (`1` = findings ≥ threshold → fail; `2` = error → fail closed).
2. **agent-triage** (only if `KIRO_API_KEY` present and PR is not from a fork):
   install Kiro CLI, run
   `kiro-cli chat --v3 --no-interactive --agent supplaiguard-coordinator --trust-tools=<explicit list> --require-mcp-startup --output-format stream-json "…"`.
   Output is attached to the summary. If it fails, job is `continue-on-error` and the
   scanner result remains the gate (R15.7).
3. **propose-fix** (`contents: write`, `pull-requests: write`; skipped for forks): apply the
   remediation to branch `supplaiguard/fix-<scan_id>`, **re-run the scanner on the patched
   tree** (verification), then open a PR whose body contains the before/after report and
   PASS/FAIL/NEEDS_REVIEW (R16.1–16.2). Never pushes to the PR branch or default branch.
4. **evolve** (opt-in; see below).

### Dependabot / security-PR handling (R15.3)

Trigger: `pull_request` filtered by `github.actor == 'dependabot[bot]'` or labels
`dependencies`/`security`. Known platform constraints to design around (verify in task 20.2):
- Workflows triggered by Dependabot get a read-only token and **cannot read normal repo
  secrets**; a `KIRO_API_KEY` must be added as a *Dependabot secret*, or the run stays
  scanner-only. The summary states which mode ran.
- Do not switch to `pull_request_target` to get secrets: that runs with write access in the
  context of untrusted PR content.
- On a Dependabot PR, SupplAIGuard's added value is: re-scan the *resulting* lockfile (does the
  bump actually clear the advisory? did it introduce a new one?), then comment the verdict.
  On non-Dependabot PRs it scans the diff and the full tree.

## Review and merge (R16.3)

The Kiro GitHub app may review/comment (`/kiro` commands) on SupplAIGuard PRs. Merge stays
human. This keeps `security-policy.md` rule 1 intact. Labels: `supplaiguard`, `needs-human`
for high-impact changes (major bump, MCP command/transport, permission changes).

## Evolution loop (R17)

```
CI run ─▶ sanitized report (rule ids, counts, outcomes, versions) ─▶ PR/issue to supplaiguard repo
        ─▶ Crew steward triages (dedupe, label, reproduce with a fixture) ─▶ proposes rule/skill change PR
        ─▶ scanner tests + PBT + demo corpus must pass ─▶ human merges ─▶ new pinned SHA ─▶ orgs bump pin
```

- **Sanitization is allow-list based:** the report schema has fixed fields only; there is no
  free-text field that could carry source or secrets. A schema check in CI rejects anything else.
- **Trust:** reports are untrusted input. They are parsed as data, never executed or pasted into
  an agent prompt verbatim.
- **Delivery credential:** GitHub App installation token with `issues:write` / `pull_requests:write`
  on the supplaiguard repo only (R17.3). Fallback for the hackathon demo: `workflow_dispatch`
  with a fine-scoped token, clearly labelled as demo-only.
- **Opt-in, off by default** (`evolve: true` input).
- **Pinning closes the loop:** improvements ship as a new SHA/tag; consumers choose when to bump.
  This keeps the "continuously evolving" claim compatible with pinned dependencies.

## Kiro Crew steward (separate repo `supplaiguard-crew`)

Crew is a persistent, self-learning agent runtime with scheduled jobs, heartbeats, subagents
and lessons (docs: kiro.dev/docs/crew). Planned role:
- **Schedule:** daily job lists open `supplaiguard-evolution` issues/PRs, groups duplicates.
- **Heartbeat:** watches the shared workflow's recent runs and alerts on repeated fail-closed errors.
- **Lessons:** maintainer corrections ("never relax MCP-001") are stored as lessons.
- **Subagents:** parallel triage of reports; each proposes a fixture + rule diff.
Unverified until task 26.1: how a Crew app is packaged/declared and what the minimal repo must
contain. Do not build the steward before that spike.

## Polished surface (Design criterion)

- `sg_scan.py --format html` produces a single self-contained report page (severity summary,
  per-finding evidence, before/after diff, verification verdict, local-vs-CI badge). Published
  as a CI artifact and on GitHub Pages for the demo.
- `--format md` produces the job summary.
- Optional Halloween styling in the HTML only; keep it readable.

## Property-based testing (R18.6)

Hypothesis tests in `scanner/tests/`:
1. For any generated list of OSV responses including errors, `exit_code == 2` whenever any lookup errored (never clean).
2. `compare_versions` is antisymmetric and transitive over generated semver-ish strings.
3. Every finding the scanner emits validates against the findings schema.
4. `recommended_version > current_version` for all dependency findings.
5. Sanitizer: for any generated finding, the evolution report contains none of the finding's `evidence` strings.

## Demo script (≤ 3:00)

0:00 problem (AI configs are a supply-chain gap) → 0:30 local: coordinator finds lodash + MCP issues
→ 1:10 approve fix, verification PASS → 1:30 push PR; shared workflow runs, Dependabot-style
bump verified → 2:10 fix PR with before/after, Kiro reviews, human merges → 2:35 evolution
report becomes a PR; Crew steward triages → 2:50 `.kiro` tour card + tagline.
