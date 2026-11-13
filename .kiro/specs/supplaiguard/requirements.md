# Requirements — SupplAIGuard (Phase 1 / MVP)

## Introduction

SupplAIGuard is an autonomous security platform that protects the software supply
chain of AI-native applications. It extends traditional dependency scanning
(GHAS, Snyk, Dependabot) by also analyzing AI-specific components — MCP server
configurations, agent skill definitions, and agent tool permissions — that
deterministic tools do not cover.

Product promise: *Prevent locally. Detect continuously. Remediate intelligently. Verify automatically.*

### Phase 1 / MVP Scope (this spec)

Phase 1 is **built entirely from Kiro primitives** — there is **no application
code** (no npm/pip packages, no FastAPI backend, no React dashboard, no custom
scanning library). The tool is composed of:

- **Custom agents** authored per the Kiro CLI V3 / IDE 1.0 agent configuration
  format as **JSON files in `.kiro/agents/`** (`name`, `description`, `prompt`,
  `tools`, `permissions`, `resources`, `hooks`). The four domain agents are
  Discovery, Threat Analysis, Remediation, and Verification, plus a Coordinator
  agent that delegates to them as sub-agents.
- **Skills** (`.kiro/skills/<name>/SKILL.md`) that package the reusable, detailed
  procedures each agent follows (OSV.dev querying, npm lockfile parsing, MCP/agent
  rule checks, findings-schema emission, remediation, verification). Skills follow
  the Agent Skills standard (YAML frontmatter `name` + `description`, markdown body)
  and are progressively loaded.
- **Steering** (`.kiro/steering/*.md`) encoding the shared security policies that
  govern every agent (single source of truth).
- **Hooks** (`.kiro/hooks/*.json` and/or inline agent hooks) for local automation.
- Agents do their work using **built-in Kiro tools** (`read`/`fs_read`,
  `write`/`fs_write`, `shell`) — e.g. calling the OSV.dev API via `curl` through
  the `shell` tool — rather than compiled code.

Primary ecosystem: **npm / Node.js** (`package.json`, `package-lock.json`).
Vulnerability intelligence: **OSV.dev**. SupplAIGuard does **not** build or host a
vulnerability database.

### Platform grounding (from Kiro docs)

- Custom agents do **not** auto-load skills; each agent MUST reference skills
  explicitly via `resources` using the `skill://` URI scheme.
- Agent permissions use capability rules (`fs_read`, `fs_write`, `shell`,
  `web_fetch`, `subagent`, `skill`, …) with effects `allow` | `ask` | `deny`;
  `deny` always wins.
- Hooks use the current array form with PascalCase triggers
  (`SessionStart`, `PreToolUse`, `PostToolUse`).
- Sub-agent tool calls are also checked against the parent session policy;
  the stricter result wins.

### Explicitly Deferred to Later Phases (NOT in this spec)

- GitHub Actions workflow, Kiro CLI headless CI wiring, GitHub App.
- Python/FastAPI backend, React/Next.js dashboard, PostgreSQL storage.
- Any general-purpose SAST engine; supporting every language.

### Glossary

- **Finding** — a structured, auditable security issue conforming to the shared JSON schema.
- **Scan** — one run of the agents over a repository workspace, producing findings.
- **MCP** — Model Context Protocol server configuration consumed by an AI agent.
- **Agent definition / agent skill** — a declared capability/instruction set for an AI agent.
- **Steering** — shared markdown policy files that constrain all SupplAIGuard agents.
- **Skill** — a `.kiro/skills/<name>/SKILL.md` instruction package referenced by an agent.

---

## Requirements

### Requirement 1 — Supply Chain Discovery (Discovery Agent)

**User story:** As a developer, I want a Discovery agent to inventory my
repository's dependencies and AI components, so that I know the full attack
surface before any threat analysis runs.

#### Acceptance Criteria

1. WHEN the Discovery agent runs against a repository THEN it SHALL locate supported package manifests (`package.json`, `package-lock.json`) using the read tool.
2. WHERE a `package-lock.json` exists THE Discovery agent SHALL extract the resolved name and version of every direct and transitive dependency.
3. WHERE only `package.json` exists without a lockfile THE Discovery agent SHALL extract declared dependencies and SHALL mark the inventory as unlocked/approximate.
4. WHEN discovering THE Discovery agent SHALL locate MCP configuration files (e.g. `.kiro/settings/mcp.json`, `mcp.json`, `**/mcp*.json`).
5. WHEN discovering THE Discovery agent SHALL locate agent definition files (e.g. `.kiro/agents/*`).
6. WHEN discovery completes THE Discovery agent SHALL emit a structured inventory (dependencies, MCP servers, agent skills) including each component's source file path.
7. IF a manifest cannot be parsed THEN the Discovery agent SHALL record a parse error for that file and SHALL continue with the remaining components.
8. THE Discovery agent SHALL operate read-only; its permissions SHALL deny `fs_write`.

### Requirement 2 — Dependency Threat Analysis via OSV.dev (Threat Analysis Agent)

**User story:** As a developer, I want the Threat Analysis agent to identify
known vulnerabilities in my dependencies, so that I can fix them before they
reach production.

#### Acceptance Criteria

1. WHEN the inventory contains npm dependencies THE Threat Analysis agent SHALL query the OSV.dev API (via the shell tool / `curl`) for known vulnerabilities per package/version.
2. WHEN OSV.dev reports a vulnerability for a dependency THE agent SHALL create a finding of type `vulnerable_dependency`.
3. WHEN a fixed version is available in OSV.dev data THE agent SHALL set `recommended_version` to the lowest non-vulnerable version and `remediation_available` to true.
4. IF no fixed version is known THEN the agent SHALL set `remediation_available` to false and SHALL still report the finding.
5. WHEN a finding is created THE agent SHALL assign a `severity` (critical|high|medium|low) and a `confidence` (high|medium|low) per the steering policy.
6. WHERE OSV.dev provides a severity/CVSS rating THE agent SHALL derive `severity` from it; OTHERWISE it SHALL default to `medium` with reduced confidence.
7. IF the OSV.dev API is unreachable or errors THEN the agent SHALL report the failure clearly and SHALL NOT emit a false "all clear" result.
8. THE agent SHALL NOT label a package malicious without supporting evidence recorded in the finding.

### Requirement 3 — AI Component Threat Analysis (Threat Analysis Agent)

**User story:** As a developer building AI apps, I want the Threat Analysis agent
to flag insecure MCP configurations and risky agent skills, so that my AI
components do not become a supply-chain entry point.

#### Acceptance Criteria

1. WHEN an MCP configuration is in the inventory THE agent SHALL evaluate it against the deterministic MCP rules defined in the AI-security steering/skill.
2. WHEN an MCP server grants broad/wildcard auto-approval (e.g. unrestricted tool approval) THE agent SHALL create a finding of type `insecure_mcp_configuration`.
3. WHEN an agent definition declares excessive permissions (e.g. unrestricted `fs_write`, unrestricted `shell`, `tools: ["*"]`) THE agent SHALL create a finding of type `excessive_tool_permissions`.
4. WHEN an agent definition contains suspicious instructions/behavior indicators THE agent SHALL create a finding of type `suspicious_agent_skill` with the matched evidence.
5. WHERE an MCP server references an unpinned or untrusted remote command/package THE agent MAY create an `insecure_integration_configuration` finding.
6. WHEN an AI-component finding is created THE agent SHALL include the matched rule id, the evidence, and a human-readable explanation.
7. THE agent SHALL deterministically identify at least one meaningful AI-specific security issue in the demo repository.

### Requirement 4 — Shared Findings Schema

**User story:** As an integrator, I want every agent to communicate through one
JSON schema, so that findings are consistent and auditable end to end.

#### Acceptance Criteria

1. THE agents SHALL represent scan results using a shared JSON schema containing `repository`, `scan_id`, `environment`, and a `findings` array.
2. THE schema SHALL support finding types: `vulnerable_dependency`, `malicious_package_indicator`, `insecure_mcp_configuration`, `excessive_tool_permissions`, `suspicious_agent_skill`, `insecure_integration_configuration`.
3. Each finding SHALL include `id`, `type`, `component`, `severity`, `confidence`, `source`, `description`, `remediation_available`, and `status`.
4. WHERE a finding concerns a versioned dependency THE finding SHALL include `current_version` and `recommended_version`.
5. THE `environment` field SHALL be one of `local` or `ci`.
6. THE schema SHALL be defined once (as a skill/steering reference) and referenced — not re-defined — by every agent.
7. THE agents SHALL emit findings that conform to this schema; malformed output SHALL be treated as an error.

### Requirement 5 — Remediation (Remediation Agent)

**User story:** As a developer, I want the Remediation agent to propose and apply
safe fixes with my approval, so that I can resolve findings without accepting
unreviewed changes.

#### Acceptance Criteria

1. WHEN a finding has `remediation_available: true` THE Remediation agent SHALL generate a concrete remediation action (e.g. a dependency version bump or configuration change).
2. WHEN remediation is proposed THE agent SHALL provide a human-readable explanation of the change and its security rationale.
3. THE Remediation agent SHALL require explicit developer approval before modifying any file (expressed as `fs_write` permission rules with effect `ask`, scoped by `match`).
4. THE Remediation agent SHALL NEVER automatically merge any change.
5. THE Remediation agent SHALL NEVER downgrade a dependency to a known-vulnerable version.
6. WHEN remediation is applied THE agent SHALL record a before/after representation of each changed file for verification.
7. WHERE a change is classified high-impact by steering THE agent SHALL require explicit human approval.

### Requirement 6 — Verification (Verification Agent)

**User story:** As a developer, I want the Verification agent to prove a fix
actually resolved the finding, so that I never rely on "a file was changed" as
evidence.

#### Acceptance Criteria

1. WHEN remediation has been applied THE Verification agent SHALL re-run the relevant checks against the modified workspace.
2. THE Verification agent SHALL mark a finding resolved ONLY IF the re-run check no longer reports it; a file modification alone SHALL NOT resolve a finding.
3. WHEN verifying THE agent SHALL produce a per-finding result of `PASS`, `FAIL`, or `NEEDS_REVIEW`.
4. WHEN verification completes THE agent SHALL produce a before-and-after report listing original findings, changes made, findings resolved, and remaining risks.
5. IF remediation introduced a regression (new finding) THEN the agent SHALL report it and set the overall result to `FAIL` or `NEEDS_REVIEW`.
6. THE verification results SHALL be traceable to specific findings by `id`.
7. THE Verification agent SHALL operate read-only with respect to source files; its permissions SHALL deny `fs_write` to repository source.

### Requirement 7 — Coordination / Orchestration (Coordinator Agent)

**User story:** As a developer, I want one entry-point agent that runs the full
lifecycle, so that I can trigger discover → analyze → remediate → verify without
manually switching agents.

#### Acceptance Criteria

1. THE project SHALL provide a Coordinator agent that invokes Discovery, Threat Analysis, Remediation, and Verification as sub-agents (via the `subagent` capability).
2. THE Coordinator SHALL run Discovery before Threat Analysis, and Verification after Remediation.
3. THE Coordinator SHALL pass the shared findings object between stages without altering its schema.
4. THE Coordinator SHALL surface a final consolidated report to the developer.
5. THE Coordinator's `permissions` SHALL only `allow` the specific sub-agents it needs and SHALL NOT grant blanket tool wildcards.

### Requirement 8 — Skills

**User story:** As a maintainer, I want the detailed detection/remediation
procedures packaged as skills, so that agents stay lean and the logic is reusable
and portable.

#### Acceptance Criteria

1. THE project SHALL provide skills under `.kiro/skills/<name>/SKILL.md` for: OSV.dev dependency analysis, npm manifest/lockfile parsing, MCP & agent-skill security rules, the findings schema contract, remediation procedure, and verification procedure.
2. Each SKILL.md SHALL begin with YAML frontmatter containing a `name` (matching its folder) and a precise `description` that reliably triggers activation.
3. Each agent SHALL reference the skills it needs via its `resources` field using `skill://` URIs (because custom agents do not auto-load skills).
4. Skills SHALL contain the detailed, reusable procedure; agent `prompt`/`description` SHALL stay concise and delegate detail to skills.
5. Skills SHALL NOT restate policies in conflict with steering; where policy applies, skills SHALL reference the steering rule.

### Requirement 9 — Steering Policies (Governance)

**User story:** As a security owner, I want shared steering policies that govern
every SupplAIGuard agent, so that the tool itself never becomes a risk and
behaves consistently.

#### Acceptance Criteria

1. THE project SHALL provide steering documents under `.kiro/steering/` encoding the security policies as a single source of truth.
2. THE steering SHALL state: never auto-merge a PR; never introduce an unverified dependency; never downgrade a security protection; never modify production secrets; require human approval for high-impact changes; always verify remediation.
3. THE steering SHALL define the severity classification and confidence-scoring rules used by the Threat Analysis agent.
4. THE steering SHALL define the deterministic MCP and agent-skill security rules referenced in Requirement 3.
5. THE steering SHALL require all agent outputs to be structured and auditable.
6. THE agents and skills SHALL reference the steering policies rather than restating conflicting rules.

### Requirement 10 — Local Hooks Automation

**User story:** As a developer, I want hooks that automate SupplAIGuard locally,
so that security runs at the right moments without manual effort.

#### Acceptance Criteria

1. THE project SHALL define at least one hook (current array form, PascalCase trigger) that triggers security analysis after relevant files change (e.g. `package.json`, `package-lock.json`, MCP/agent config files).
2. THE project SHALL define a hook (or documented hook pattern) that requests verification after a remediation change (e.g. a `PostToolUse` matcher on write tools).
3. WHERE a hook runs THE hook SHALL invoke the shared agents/skills/policies rather than duplicating rules.
4. THE hooks SHALL fail safe: a hook error SHALL surface a clear warning and SHALL NOT silently suppress findings.

### Requirement 11 — Demo Repository

**User story:** As a presenter, I want a predictable vulnerable demo repository,
so that the end-to-end story reliably reproduces during the demonstration.

#### Acceptance Criteria

1. THE project SHALL include a sample demo repository containing at least one known-vulnerable npm dependency (pinned to a specific vulnerable version).
2. THE demo repository SHALL include at least one insecure MCP configuration and/or an agent definition with excessive permissions.
3. WHEN SupplAIGuard runs against the demo repository THE agents SHALL deterministically detect the seeded dependency vulnerability and the seeded AI-component issue.
4. THE demo repository SHALL support demonstrating the full local lifecycle: discover → analyze → remediate (with approval) → verify.

### Requirement 12 — Post-Task Review (Review Agent on a Different Model)

**User story:** As a developer building SupplAIGuard, I want a review agent that
runs automatically after each task completes using a different model, so that a
second, independent model cross-checks the work and catches issues the primary
model missed.

#### Platform grounding (from Kiro docs)

- The `Stop` hook trigger fires when the assistant finishes responding to the
  user (end of a turn/task) — this is the "after each task is complete" trigger.
- Hooks support an `agent` action (a `prompt` that starts a new agent loop) and a
  `command` action. The hook schema has **no model field**; model selection is a
  property of an *agent* (the `model` field in an agent config).
- Therefore "a different model" is achieved by having the `Stop` hook delegate to
  a dedicated **review sub-agent** whose config pins a `model` different from the
  primary session's model.

#### Acceptance Criteria

1. THE project SHALL provide a dedicated Review agent (`.kiro/agents/supplaiguard-reviewer.json`) whose `model` field is pinned to a model different from the primary working agent's model.
2. THE project SHALL provide a `Stop`-triggered hook (`.kiro/hooks/review-after-task.json`) that runs after each completed task.
3. WHEN the hook fires THE action SHALL invoke the Review agent (via an `agent` action prompt that delegates to the reviewer sub-agent, or via a `command` action that launches the reviewer) so the review executes under the reviewer's pinned model.
4. THE Review agent SHALL inspect the changes made during the completed task and produce a structured review: correctness against the spec, security-policy adherence (per steering), and any required follow-ups.
5. THE Review agent SHALL operate read-only with respect to source files; its permissions SHALL deny `fs_write`. It SHALL report issues rather than silently fixing them.
6. THE Review agent SHALL check the completed work against the relevant requirement acceptance criteria and the steering security policy, and SHALL flag any deviation.
7. IF the configured reviewer model is unavailable THEN the hook SHALL fail safe: surface a clear warning and SHALL NOT block or discard the completed task's work.
8. WHERE repeated automatic review on every turn is undesirable THE hook MAY use a `confirm` block (supported on `Stop` command hooks) or an `enabled: false` toggle so the developer controls when review runs.

---

# Phase 2 & 3 Additions

Source: `../notes/phase2-checkpoint.md` (Phase 2, built) and
`../notes/uptomize.md` (Phase 3, planned: CI mode + self-evolution + hackathon fit).

Phase 2 changed two Phase 1 assumptions, recorded here so the spec stays honest:
- Agents target **Kiro CLI v3** (`permissions.rules`), not the 2.x schema used in Phase 1.
- Detection is **hybrid**: a deterministic scanner (`scanner/sg_scan.py`) does exact-match
  rules and OSV lookups; the LLM handles SKL-* semantics, triage and remediation.
  This supersedes "agents call `curl` to OSV directly" in R2.1 and R3.1.

### Requirement 13 — Global Install (Phase 2, built)

**User story:** As a developer, I want SupplAIGuard runnable from any repository.

1. `install.sh` SHALL install agents to `~/.kiro/agents` and policies, skills and the scanner to `~/.kiro/supplaiguard/`, and SHALL NOT place policies in `~/.kiro/steering` (they would load into every chat).
2. `install.sh` SHALL support `--dry-run` and `--uninstall`.
3. Agents SHALL be discoverable from any working directory after install.

### Requirement 14 — Deterministic Scanner (Phase 2, built; agent wiring pending)

1. The scanner SHALL implement MCP-001..005, AGT-001..004, SKL-001..005 exactly as defined in the steering catalog, plus npm `package-lock.json` and PyPI `requirements*.txt` (`==` pins) lookups via OSV.dev.
2. The scanner SHALL exit 0 (clean), 1 (findings), 2 (errors) and SHALL NEVER report a clean result when OSV was unreachable.
3. The scanner output SHALL conform to `sg-findings-schema`.
4. Threat-analysis and verification agents SHALL run the scanner first and use the LLM only for SKL semantics, triage and explanation. Verification SHALL re-run the same scanner so local and CI results are comparable.

### Requirement 15 — CI Mode via Shared Org Workflow (Phase 3)

**User story:** As a platform owner, I want repos whose developers did not run SupplAIGuard locally to still get scanned in CI, from one shared definition.

1. THE project SHALL provide a reusable workflow (`on: workflow_call`) hosted in one shared repository, consumable by any repo in the org with a one-line `uses:` reference.
2. Consumers SHALL pin the shared workflow and the SupplAIGuard agents/scanner to a **commit SHA or signed tag**, not a branch (supply-chain rule: do not ship an unpinned remote dependency from a tool that flags unpinned remote dependencies).
3. THE workflow SHALL trigger on `pull_request` (opened, synchronize, reopened), on a schedule, and on `workflow_dispatch`. It SHALL give special handling to Dependabot and other security-update PRs (author `dependabot[bot]`, label `security`/`dependencies`).
4. THE workflow SHALL always run the deterministic scanner (no API key required) and SHALL publish a job summary and a pass/fail gate by severity threshold.
5. WHERE `KIRO_API_KEY` is available THE workflow SHALL additionally run Kiro CLI headless (`kiro-cli chat --v3 --no-interactive --agent supplaiguard-coordinator`, with explicit `--trust-tools`, never `--trust-all-tools`) for triage and remediation proposals. WHERE it is not available (forks, Dependabot without a Dependabot-scoped secret) THE workflow SHALL degrade to scanner-only and say so in the summary.
6. THE workflow SHALL use least-privilege `permissions:`, SHALL NOT use `pull_request_target` to run untrusted PR code, and SHALL NOT expose secrets to forked PRs.
7. IF a Kiro run fails or the sandbox/MCP cannot start THEN the workflow SHALL fail closed on the scanner result, never silently pass.

### Requirement 16 — CI Remediation PRs and Review (Phase 3)

1. WHEN findings have `remediation_available: true` THE workflow SHALL open a PR from a dedicated branch (e.g. `supplaiguard/fix-<scan_id>`) containing the proposed fix, the before/after report, and the verification result. It SHALL NOT push to the PR's own branch or default branch.
2. THE remediation PR SHALL only be opened after the Verification stage re-runs the scanner on the patched tree. The PR body SHALL state PASS / FAIL / NEEDS_REVIEW.
3. THE Kiro GitHub app MAY review these PRs. SupplAIGuard SHALL NOT merge. Merging remains a human action, consistent with `security-policy.md` rule 1. (The note's "merge if good to go with human approval" is interpreted as: Kiro recommends, a human approves and merges.)
4. High-impact changes (major bumps, MCP command/transport, permission changes) SHALL be labelled `needs-human` and SHALL NOT be auto-approved by any agent.

### Requirement 17 — Continuous Evolution Loop (Phase 3)

**User story:** As a SupplAIGuard maintainer, I want every CI run to feed back what the agents got wrong or missed, so the rules and agents improve over time.

1. WHEN an org enables the feature (opt-in, off by default) THE CI run SHALL emit a **sanitized evolution report**: rule IDs hit, counts, false-positive/unresolved signals, verification outcomes, scanner/agent version. It SHALL NOT contain source code, config excerpts, secret values, repo names (unless the org opts in), or file contents.
2. THE report SHALL be delivered as a PR (or issue) to the SupplAIGuard repository proposing a concrete change (new/adjusted rule, skill wording, fixture) with a regression fixture added to the demo/test corpus.
3. Cross-repo delivery SHALL use a GitHub App installation token or equivalent scoped credential, not a broad PAT.
4. Evolution PRs SHALL be treated as **untrusted input**: they only add structured data and fixtures; a maintainer (or the maintainer-side Crew, see design) reviews them; nothing auto-merges.
5. A proposed rule change SHALL be accepted only if the scanner's test suite and the demo corpus still produce the expected findings (no regression).

### Requirement 18 — Kiroween 2026 Readiness

Source: `../notes/kiroween/{kiroween.md,rules.md,resources.txt}` (verified against the 2026 pages).
Deadline: **Fri Dec 4, 2026, 2:00 PM PT**. Credits request: by Dec 1 (4,000 credits, ID check); redeem by Dec 4.
Target category: **Frankenstein** (security scanner + LLM agents + CI + a self-evolving Crew loop). Bonus targets: **Best Kiro Crew App**, **Best Demo**, **Bonus Blog**, **Social Blitz**.

1. **New work only.** Everything submitted SHALL be created on/after Oct 30, 2026. Any pre-existing code or work SHALL be disclosed in the README. (Repo history starts Nov 2026; keep commits from the start so this is provable.)
2. THE repository SHALL be public on **GitHub** with an OSI-approved `LICENSE` detectable in the repo "About" box, containing all source, assets and run instructions.
3. `/.kiro` SHALL be at the repo root and SHALL NOT appear in any `.gitignore` (disqualification risk).
4. THE submission SHALL include a working-app URL or equivalent run instructions that judges can follow, a text description, and a public YouTube demo video under **3 minutes** showing the project working end to end, with no third-party trademarks or copyrighted music.
5. THE README/write-up SHALL cover every Kiro feature used, with repo pointers: IDE/CLI/Web/Crew differences, custom agents, hooks, spec-driven vs vibe coding, steering, MCP, **property-based testing**, and powers (if any).
6. **Property-based testing:** THE scanner SHALL have property-based tests (e.g. Hypothesis) for invariants such as: never reports clean when OSV errored; version comparison is a total order; every emitted finding validates against `sg-findings-schema`; "fixed version" is always greater than the installed version.
7. **Best Kiro Crew App:** THE Crew component SHALL live in a **separate public GitHub repo**, created during the period, under the same GitHub account as the main submission, with its own README describing features.
8. THE judging criteria are five, equally weighted: Potential Impact, Technological Implementation, Design, Innovation, Presentation. The plan SHALL include a polished user-facing surface (not only JSON): a CI job summary and a generated HTML report (see design), so Design is not a proof-of-concept.
9. THE project SHALL scan its own `.kiro/` in CI (self-scan) as dogfooding proof.
10. Bonus content: a public blog post (mentioning Kiroween 2026) and a social post with `#KiroweenHackathon26` as the first token, both published inside the submission period, with URLs added to the form.
