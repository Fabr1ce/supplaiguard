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

---

# Phase 2 (status) and Phase 3 (plan)

Deadline: **Fri Dec 4, 2026, 2:00 PM PT**. Today is Nov 12, so ~22 days. Priorities are ordered so a
submittable product exists at the end of each block (cut from the bottom if time runs short).

## Phase 2 — status (from `../notes/phase2-checkpoint.md`)

- [x] 15. v3 agent configs (`kiro-cli agent upgrade`), all validate _(R13)_
- [x] 16. `install.sh` global install with `--dry-run`/`--uninstall` _(R13)_
- [x] 17. Deterministic scanner `scanner/sg_scan.py` (MCP/AGT/SKL + npm/PyPI via OSV) _(R14.1–14.3)_
- [x] 18. Demos: `crypt-keeper-mcp` (MCP server), `haunted-storyteller` (Strands app), `vulnerable-ai-app`
- [ ] 19. Phase 2 remainder
  - [x] 19.1 Scanner wired into threat-analysis + verification prompts; `install.sh` copies it to `~/.kiro/supplaiguard/scanner/`; both agents' shell rules allow exactly `python3 ~/.kiro/supplaiguard/scanner/sg_scan.py *` _(R14.4)_. Not yet exercised by a live agent run (see 19.2)
  - [ ] 19.2 Interactive end-to-end run from a demo dir; closes 13.3, 13.4, 13.7
  - [ ] 19.3 Demo READMEs (which findings are seeded on purpose)
  - [ ] 19.4 README rewrite (mermaid loop, one-line-per-file tree, v3 run instructions). The loop is now FIVE stages, matching the logo: discover → analyze → remediate (with your approval) → verify → **learn** → back to discover. Learn = verification outcomes and CI findings feed back into rules/skills via the evolution loop (R17). Logo, badges, quick start and why-agents sections are done; logo is rebuilt with `python3 assets/build_logo.py` (needs `cairosvg` for PNGs)
  - [x] 19.5 MIT `LICENSE` added; root `.gitignore` added and does NOT ignore `.kiro` _(R18.2–18.3)_. Still open: decide on `demo/vulnerable-ai-app/.kiro/agents/overprivileged.json.bak`
  - [x] 19.6 Remote `Fabr1ce/supplaiguard` is public with `initial commit` 3637eef (2026-11-12), same as local HEAD; proves new-work dates _(R18.1)_. Local work is uncommitted; `git push` over SSH fails here (no key), see decisions below
  - [ ] 19.7 Confirm GitHub shows "MIT" in the repo About box after the license is pushed _(R18.2)_

## Phase 3 — CI mode, evolution, Kiroween

### Block A — Submittable core (do first)
- [ ] 20. CI workflow
  - [x] 20.1 Added `--format md|html|json`, `--fail-on`, `--environment`, `--out-dir` to the scanner; reports escape all untrusted text and ship no scripts _(R15.4, R18.8)_
  - [ ] 20.2 Spike: confirm Dependabot-run secret behavior and a read-only token on a throwaway repo; record result in design _(R15.3, R15.5)_. Until verified, `examples/consumer-workflow.yml` states it as expected behavior (Dependabot reads its own secrets store)
  - [x] 20.3 `.github/workflows/scan.yml` (`workflow_call`): SHA-pinned actions, per-job least privilege, inputs via `env:`, sg-ref must be a full SHA, suppressions from the PR base commit. `actionlint` clean. Live run: see 20.5 _(R15.1, R15.4, R15.6)_
  - [x] 20.4 `examples/consumer-workflow.yml` (placeholders for the pinned SHA) _(R15.2)_
  - [~] 20.5 `.github/workflows/self-scan.yml` written (calls the reusable workflow on `.kiro`, `fail-on: low`). First real run happens on the PR; the PR that introduces `.supplaiguard/suppressions.json` is scanned with the base's (absent) file, so that one run is expected to fail by design _(R18.9)_
  - [~] 20.6 `agent-triage` job written, OFF by default, advisory, **untested** (no API key yet). Hardened after finding that headless Kiro auto-loads workspace agents/steering/MCP config: runs in an empty directory, read-only tools, deny rules for /proc, /etc, ~/.ssh. Still to do: `--require-mcp-startup` is unnecessary with no MCP servers; pin the Kiro installer version/checksum if published _(R15.5, R15.7)_
  - [x] 20.7 Scanner suppressions (reason required, no blanket entries, expiry, always listed, broken file exits 2) + `.supplaiguard/suppressions.json` for our own docs _(R19)_
  - [x] 20.8 Scanner robustness found by property tests: odd JSON shapes no longer crash the scan (each file is guarded, failures become scan errors, exit 2); non-object MCP entries and unparseable configs are errors, not silent skips; agent configs with no `name` (optional in Kiro) are now scanned; any internal error exits 2 _(R19)_
  - [ ] 20.9 Optional `--baseline FILE` to report new vs fixed findings against the PR base
- [~] 21. Property-based tests _(R18.6)_
  - [x] 21.1 `scanner/tests/test_properties.py` (pytest 9.2.0 + Hypothesis 6.170.15, Python 3.15): 36 tests (was 11) covering never-clean-on-error, threshold exit codes, semver order, schema validity, strictly-newer fixes, every-installed-version-checked, report escaping, and a demo regression corpus
  - [ ] 21.2 Run in CI (pending the workflow); **what PBT caught:** `lock_packages` keyed results by package name, so when a lockfile held several versions of one package only one was checked and a vulnerable older copy could go unreported (false negative). Found by `test_every_installed_version_of_a_package_is_checked`, fixed by returning every `(name, version)` pair. Also caught: odd-but-valid JSON crashed the scanner with exit 1 and no report (so a hostile file could kill a scan and look like "findings"); agent configs without a `name` field were silently skipped; a Python 3.10 incompatibility (backslash in an f-string expression)

### Block B — The story
- [ ] 22. Remediation PRs in CI
  - [ ] 22.1 `propose-fix` job: branch `supplaiguard/fix-<scan_id>`, patch, re-scan, open PR with before/after + verdict _(R16.1–16.2)_
  - [ ] 22.2 Labels incl. `needs-human` for high-impact; no merge step anywhere _(R16.3–16.4)_
  - [ ] 22.3 Install the Kiro GitHub app on the demo org/repo and confirm `/kiro` review on a SupplAIGuard PR (spike; record outcome) _(R16.3)_
- [ ] 23. HTML report + GitHub Pages _(R18.8)_
- [ ] 24. Demo repo for CI: a consumer repo with a seeded Dependabot-style bump PR

### Block C — Evolution loop + Crew (bonus prize)
- [ ] 25. Evolution report
  - [ ] 25.1 Define allow-list schema `evolution-report.schema.json`; sanitizer + property test 5 _(R17.1)_
  - [ ] 25.2 `evolve` job (opt-in) opens a PR/issue on this repo via GitHub App token _(R17.2–17.3)_
  - [ ] 25.3 Acceptance gate: scanner tests + PBT + demo corpus must pass for any rule change _(R17.5)_
- [ ] 26. Crew steward (new repo `supplaiguard-crew`)
  - [ ] 26.1 **Spike first:** install Kiro Crew, learn how a Crew app is packaged and what the repo must contain for the bonus prize _(R18.7)_
  - [ ] 26.2 Scheduled triage job + heartbeat + one stored lesson
  - [ ] 26.3 Create the repo (public, same GitHub account, new during the period) with README

### Block D — Submission
- [ ] 27. Request Kiro credits (**by Dec 1**, ID check) — user action
- [ ] 28. Kiro-usage write-up: IDE vs CLI vs Web vs Crew, agents, hooks, specs vs vibe, steering, MCP, PBT, powers _(R18.5)_
- [ ] 29. Demo video script + recording ≤ 3:00, uploaded public to YouTube _(R18.4)_
- [ ] 30. Blog post and `#KiroweenHackathon26` social post, URLs in the form _(R18.10)_
- [ ] 31. Final checks: license visible, `.kiro` not ignored, repo public, run instructions tested from a clean clone _(R18.2–18.4)_

## Open risks
- **Merge wording:** the note says Kiro may "merge if good to go with human approval". Plan keeps merging human-only to honour policy rule 1; confirm that is acceptable.
- **Kiro API key in CI:** headless needs `KIRO_API_KEY`; if unavailable the demo shows scanner-only plus local agents.
- **Crew packaging unknown** until task 26.1; Block C may shrink.
- **Sharing pattern:** everything lives under the `Fabr1ce` account (shared `supplaiguard` repo, a consumer demo repo, later `supplaiguard-crew`). The consumer calls the shared workflow via `uses: Fabr1ce/supplaiguard/.github/workflows/scan.yml@<sha>`.
- **No `KIRO_API_KEY`** in this environment yet; needed for the headless CI job (task 20.6) and must be stored as a repo secret, never committed.
- **Push access:** remote is SSH, no SSH key here; `gh` is authenticated over HTTPS (scopes: repo, workflow, read:org).
- **Credits:** headless CI runs consume Kiro credits; keep triage runs small.
