# Tasks: Reasoning Demo ("seance-gateway")

Test-first where code exists. Each task cites requirements as `(Dn.m)`.

- [ ] 1. Scenario feasibility (no repo code yet)
  - [x] 1.1 Done 2026-11-19, see feasibility.md. Query OSV for candidate npm packages matching each shape (S1 major-only fix, S2 transitive with pinned parent, S3 two advisories in one package with separable functions, S4 peer-range conflict); record advisory ids, fixed versions, date _(D4.1)_
  - [x] 1.2 No scenario dropped; S3 and S4 reshaped (feasibility.md, Spec changes). Drop or replace any scenario with no real candidate; record the decision _(D4.2)_
  - [ ] 1.3 Write `eval/ground-truth.json` and commit it before any agent run _(D3.4)_

- [ ] 2. Scorer first (so the demo cannot be tuned to the score after the fact)
  - [ ] 2.1 Tests for `eval/score.py` against hand-built good and bad repository states per scenario _(D3.2)_
  - [ ] 2.2 Implement `eval/score.py` (deterministic, no LLM) _(D3.2)_

- [ ] 3. Application skeleton
  - [ ] 3.1 TypeScript gateway: HTTP API, MCP server, config loader, render module _(D1.1)_
  - [ ] 3.2 Test suite covering every scenario path; passes on the unmodified code _(D1.2, D1.3)_

- [ ] 4. Seed scenarios S1 to S7 (one commit each, so the history shows the shape)
  - [ ] 4.1 S1, S2, S3, S4 dependency shapes with the verified versions _(D2.1-D2.4)_
  - [ ] 4.2 S5 chain: `.kiro/settings/mcp.json`, `.kiro/agents/gateway.json`, `.kiro/skills/env-helper/SKILL.md`, parser advisory; fake secrets only _(D2.5, D4.4)_
  - [ ] 4.3 S6 tool-description injection, S7 docs fixture _(D2.6, D2.7)_

- [ ] 5. Baseline
  - [ ] 5.1 `eval/run-baseline.sh` and `eval/reset.sh` _(D3.1, D5.1)_
  - [ ] 5.2 Automated test: baseline fails S1, S2, S4, S5, S7 while the scanner reports clean for at least S1 _(D3.3)_

- [ ] 6. Agent support for the scored outputs
  - [ ] 6.1 Add the `ANALYSIS_RESULT` block (chains, proposed suppressions, flags) to the findings schema skill and the Threat Analysis agent _(design: Scoring)_
  - [ ] 6.2 Reachability step in the Threat Analysis skill: for each vulnerable dependency, find imports and call sites before ranking _(D2.3)_
  - [ ] 6.3 Deny `eval/**` in the demo's agent access; confirm no agent permission is weakened (existing policy tests still pass) _(D3.4, D4.3)_

- [ ] 7. Recorded run
  - [ ] 7.1 Run the coordinator on a copy; approve writes as a normal user; keep the transcript _(D4.3)_
  - [ ] 7.2 Score it, save `eval/runs/<date>-<model>.json`, including failures _(D3.5, D5.3)_
  - [ ] 7.3 README section: baseline table, agent table, model, date, "one sample" note _(D3.5, D5.2)_

- [ ] 8. Wire into the project README and CI
  - [ ] 8.1 Link the demo from the root README; keep the existing demos _(D3.5)_
  - [ ] 8.2 CI job that runs the demo's tests and `eval/tests` (no LLM, no secrets) _(D1.3, D3.3)_
