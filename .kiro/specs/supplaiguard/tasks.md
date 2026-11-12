# Tasks — SupplAIGuard (Phase 1 / MVP)

Implementation plan. Each task is incremental and references the requirements it
satisfies as `(Rn.m)`. Build order: validate platform facts → steering → skills →
schema → agents → coordinator → hooks → demo repo → end-to-end verification.

- [ ] 1. Validate Kiro platform facts before authoring configs
  - [x] 1.1 Confirm the exact CLI V3 Hooks trigger for file changes (`FileEdited` vs `PostToolUse` + write matcher) and the standalone hook file schema in `.kiro/hooks/*.json`
  - [x] 1.2 Confirm the `subagent` capability/selector syntax (`subagent/<name>`) and that sub-agents inherit `always` steering
  - [x] 1.3 Confirm `skill://` resource globbing works for workspace skills and that custom agents require explicit `skill://` references
  - [x] 1.4 Confirm how a `Stop` hook can route to a specific sub-agent on a different model: test whether an `agent`-action prompt reliably delegates to `supplaiguard-reviewer`, or whether a `command` action launching the reviewer agent is required; confirm a second available model ID via `/model` _(R12.1, R12.3)_
  - _Design: Hooks "open validation items"; Requirements: R7, R8.3, R10, R12_

  > **Task 1 findings (runtime = kiro-cli 1.21.0):**
  > - **Agents use the 2.x schema**, NOT V3 `permissions.rules`. Installed example
  >   (`~/.kiro/agents/agent_config.json.example`) uses `allowedTools`,
  >   `toolsSettings` (`allowedCommands`/`deniedCommands`/`allowedPaths`/`deniedPaths`),
  >   object-form inline `hooks`, `useLegacyMcpJson`, `model`. All agent configs in
  >   this spec are authored in **2.x form** and validated with `kiro-cli agent validate`.
  > - **Hooks use the `version:"v1"` array form with PascalCase triggers**
  >   (`AgentSpawn`, `Stop`, `PostToolUse`, …) — matches the design. The installed
  >   `~/.kiro/hooks/fix-documenter.json` confirms `Stop` and `command` actions work.
  > - **Skills** use standard `SKILL.md` + YAML frontmatter (`name`, `description`) —
  >   matches the design. Referenced from agents via `resources` (`skill://` or
  >   `file://` to the SKILL.md).
  > - **Different-model review:** hooks have no model field (confirmed). The `Stop`
  >   `command` action is the deterministic route — it runs
  >   `kiro-cli chat --agent supplaiguard-reviewer --no-interactive ...`, and the
  >   reviewer agent's own `model` field pins the different model. (Agent-action
  >   prompts cannot force a specific sub-agent/model, so we use `command`.)
  > - Tooling present: `curl`, `jq`, `node`, `npm`.

- [x] 2. Author steering policies (single source of truth)
  - [x] 2.1 Create `.kiro/steering/security-policy.md` (inclusion: always) with the non-negotiables: no auto-merge, no unverified deps, no security downgrade, no secret modification, human approval for high-impact, always verify, structured/auditable output _(R9.1, R9.2, R9.5)_
  - [x] 2.2 Create `.kiro/steering/severity-and-confidence.md` with CVSS→severity bands and confidence rules _(R9.3)_
  - [x] 2.3 Create `.kiro/steering/ai-component-security-rules.md` with the deterministic MCP + agent-skill rule catalog (rule IDs, matchers, finding types) _(R9.4, R3)_

- [x] 3. Define the findings schema contract skill
  - [x] 3.1 Create `.kiro/skills/sg-findings-schema/SKILL.md` with frontmatter and the canonical JSON schema, enums, required fields, a valid example, and a validation checklist _(R4.1–R4.7, R8.2)_

- [x] 4. Author detection/remediation skills
  - [x] 4.1 Create `.kiro/skills/sg-npm-inventory/SKILL.md` — parse `package-lock.json` (v1/v2/v3) and `package.json`; unlocked fallback; parse-error handling _(R1.2, R1.3, R1.7, R8)_
  - [x] 4.2 Create `.kiro/skills/sg-osv-dependency-scan/SKILL.md` — OSV.dev `querybatch` request shape (`ecosystem: npm`), fix-version extraction, CVSS→severity mapping, API-failure handling _(R2.1–R2.7, R8)_
  - [x] 4.3 Create `.kiro/skills/sg-ai-component-rules/SKILL.md` — procedure that applies the steering rule catalog to MCP + agent files and emits AI-component findings _(R3.1–R3.6, R8.5)_
  - [x] 4.4 Create `.kiro/skills/sg-remediation/SKILL.md` — safe version-bump selection (forward-only), config tightening, before/after capture, forbidden actions _(R5.1, R5.2, R5.5, R5.6, R8)_
  - [x] 4.5 Create `.kiro/skills/sg-verification/SKILL.md` — per-finding re-scan, PASS/FAIL/NEEDS_REVIEW rules, regression detection, report format _(R6.1–R6.6, R8)_

- [x] 5. Author the Discovery agent  _(2.x schema: `allowedTools`/`toolsSettings`; validated with `kiro-cli agent validate`)_
  - [x] 5.1 Create `.kiro/agents/supplaiguard-discovery.json` with `tools: ["read"]`, `toolsSettings.fs_write.deniedPaths: ["**"]`, resources referencing `sg-npm-inventory`, `sg-findings-schema`, steering _(R1.1, R1.4, R1.5, R1.6, R1.8, R8.3)_
  - [x] 5.2 Write `prompts/discovery.md` describing the read-only inventory procedure and inventory output shape _(R1.6)_

- [x] 6. Author the Threat Analysis agent
  - [x] 6.1 Create `.kiro/agents/supplaiguard-threat-analysis.json` with `tools: ["read","shell"]`, shell `allowedCommands` restricted to `curl https://api.osv.dev/*` (+ echo/jq), `fs_write` denied, resources referencing OSV + AI-rules + schema skills and all steering _(R2, R3, R8.3)_
  - [x] 6.2 Write its prompt tying together dependency scan (OSV) and AI-component scan (rules), emitting schema-conformant findings _(R2.2, R3.6, R4.7)_

- [x] 7. Author the Remediation agent
  - [x] 7.1 Create `.kiro/agents/supplaiguard-remediation.json` with `tools: ["read","write","shell"]`, `fs_write.allowedPaths` scoped to manifests/config, `deniedPaths` on secret/prod paths (writes still prompt by default) _(R5.3, R9.2)_
  - [x] 7.2 Write its prompt enforcing forward-only bumps, no merge, before/after capture, high-impact approval _(R5.1, R5.2, R5.4, R5.5, R5.6, R5.7)_

- [x] 8. Author the Verification agent
  - [x] 8.1 Create `.kiro/agents/supplaiguard-verification.json` with `tools: ["read","shell"]`, shell allow-listed to OSV, `fs_write` denied _(R6.7)_
  - [x] 8.2 Write its prompt enforcing "resolved only if re-check clears it", regression detection, before/after report keyed by finding `id` _(R6.2, R6.4, R6.5, R6.6)_

- [x] 9. Author the Coordinator agent
  - [x] 9.1 Create `.kiro/agents/supplaiguard-coordinator.json` with `delegate` + `toolsSettings.subagent.availableAgents` limited to the four domain agents (remediation NOT trusted so it still prompts), no write _(R7.1, R7.5)_
  - [x] 9.2 Write its prompt enforcing stage order (Discovery→Threat→[approval]→Remediation→Verification), schema-preserving hand-offs, consolidated final report _(R7.2, R7.3, R7.4)_

- [x] 10. Author local hooks  _(`version:"v1"` array form; JSON validated)_
  - [x] 10.1 Create `.kiro/hooks/analyze-on-manifest-change.json` (`PostFileSave` + path matcher) to run analysis when manifests/MCP/agent files change _(R10.1, R10.3)_
  - [x] 10.2 Create `.kiro/hooks/verify-after-remediation.json` (`PostToolUse` on write tools) to run Verification after a remediation edit _(R10.2, R10.3)_
  - [x] 10.3 Fail-safe: hook actions do not suppress findings; command failures surface as warnings per Kiro hook semantics _(R10.4)_

- [x] 11. Author the post-task Review agent and hook (different model)
  - [x] 11.1 Create `.kiro/agents/supplaiguard-reviewer.json` with `model: "claude-sonnet-4.6"` (different from primary), `tools: ["read","shell"]` (shell limited to read-only `git diff/status/log/show`), `fs_write` denied, resources referencing the spec + steering policy + `sg-findings-schema` _(R12.1, R12.4, R12.5, R12.6)_
  - [x] 11.2 Write `prompts/reviewer.md` describing the read-only review (correctness vs. acceptance criteria, security-policy adherence, follow-ups; report-only, never fix) _(R12.4, R12.5, R12.6)_
  - [x] 11.3 Create `.kiro/hooks/review-after-task.json` with `version:"v1"`, `trigger:"Stop"`, a `command` action launching `kiro-cli chat --agent supplaiguard-reviewer --no-interactive` (reviewer's pinned model governs → different model), plus a `confirm` block for developer control _(R12.2, R12.3, R12.8)_
  - [x] 11.4 Fail-safe: the command is wrapped with `|| echo WARN…` so a model/launch failure surfaces a warning and never blocks or discards the completed task _(R12.7)_

- [x] 12. Build the deterministic demo repository
  - [x] 12.1 `lodash@4.17.4` confirmed vulnerable against OSV.dev (9 advisories, incl. GHSA-29mw-wpgm-hmr9; fixed 4.17.21); created `demo/vulnerable-ai-app/package.json` + `package-lock.json` _(R11.1)_
  - [x] 12.2 Added `demo/vulnerable-ai-app/.kiro/settings/mcp.json` — wildcard `autoApprove` (MCP-001), unpinned `@latest` (MCP-003), hardcoded secret (MCP-005) _(R11.2)_
  - [x] 12.3 Added `demo/vulnerable-ai-app/.kiro/agents/overprivileged.json` — `tools/allowedTools: ["*"]` (AGT-001) + bypass-safety prompt (SKL-002/005) _(R11.2)_

- [~] 13. End-to-end verification against the demo repo  _(deterministic logic verified via scripted checks; items needing an interactive chat session are noted)_
  - [x] 13.1 Deterministic detection confirmed by script: OSV returns 9 advisories for lodash@4.17.4 (fixed 4.17.21, MODERATE→medium); MCP-001/003/005, AGT-001, SKL-002/005 all match the seeded files _(R3.7, R11.3)_
  - [x] 13.2 `sg-findings-schema` documents required fields/enums + a `jq`-parseable validation checklist; demo configs produce schema-mappable findings _(R4.7)_
  - [ ] 13.3 Remediation gating — requires an interactive `kiro-cli chat` run to observe the `fs_write` approval prompt (config enforces scoped paths + denies secrets; prompt-on-write is default 2.x behavior) _(R5.3)_
  - [ ] 13.4 Verification honesty — requires an interactive run: non-fixing edit must NOT resolve; real bump to 4.17.21 must re-query clean _(R6.2)_
  - [x] 13.5 OSV failure path documented in `sg-osv-dependency-scan` (record ScanError, never emit false all-clear); enforced by prompt + steering _(R2.7)_
  - [x] 13.6 Permission posture confirmed by script: discovery/verification/reviewer deny all writes; remediation denies secret paths; reviewer pinned to a different model; all six agents pass `kiro-cli agent validate` _(R1.8, R2 shell allow-list, R6.7)_
  - [ ] 13.7 Post-task review live run — requires an interactive session to confirm the `Stop` hook launches the reviewer on the different model and emits a structured review _(R12.2, R12.3, R12.4)_

- [x] 14. Documentation
  - [x] 14.1 Added top-level `README.md` describing the local lifecycle, Coordinator invocation, the post-task review flow, and the demo walkthrough _(supports R11.4, R12)_
