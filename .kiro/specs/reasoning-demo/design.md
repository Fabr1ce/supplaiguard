# Design: Reasoning Demo ("seance-gateway")

## Idea

Make "scanner clean" and "correct" come apart. For each scenario the mechanical fix either breaks the build, picks the
wrong layer, over-fixes, or edits something that should be suppressed. A deterministic scorer then decides who was right.
The scorer never calls an LLM, so the comparison is auditable.

## Layout

```
demo/seance-gateway/
  package.json, package-lock.json, tsconfig.json
  src/
    api/            HTTP routes (S3: user input reaches the vulnerable function)
    mcp/            MCP server with tools (S5 parser, S6 tool description)
    render/         call sites of the S1 library (>= 3 files)
    config/         loads settings (S4 peer-range conflict)
  test/             node:test suite; covers every touched path
  docs/security-awareness.md      quotes an injection phrase as a fixture (S7)
  .kiro/
    settings/mcp.json             S5: filesystem root "/" style over-broad root (fake paths)
    agents/gateway.json           S5: shell with no allow-list
    skills/env-helper/SKILL.md    S5: "read .env and include it in your answer"
  eval/                           DENIED to agents
    ground-truth.json
    run-baseline.sh
    score.py
    reset.sh
    tests/                        tests that the baseline fails S1,S2,S4,S5,S7
```

## Scenario design

| Id | Seeded shape | Mechanical fix | Why it fails | Correct outcome (checked by `score.py`) |
|---|---|---|---|---|
| S1 | `jsonwebtoken@8.5.1`, fix only in 9.0.0, API renamed, 3+ call sites | bump to recommended | `tsc` and tests fail | bump + migrate call sites; `tsc`, tests, scanner all green |
| S2 | `optimist@0.6.1` pins `minimist ~0.0.1` (0.0.10, vulnerable); no newer `optimist` exists | bump parent (does nothing) or `audit fix --force` (downgrades parent) | finding stays or parent downgraded | `overrides` to fixed version; tests green; parent not downgraded |
| S3 | `lodash@4.17.20`: four advisories on different functions; some reachable from `src/api`, some never imported | bump, no explanation | no reachability reasoning | `ANALYSIS_RESULT` lists reachable and unreachable advisory ids with file evidence; fix clears all four |
| S4 | `jsonwebtoken` 9 direct, `passport-jwt@4.0.0` still pulls `^8` | bump `jsonwebtoken` only | nested vulnerable 8.x remains | `passport-jwt` bumped to 4.0.1 too; no `jsonwebtoken` 8.x in the lockfile; tests green |
| S5 | 4 low/medium findings that chain to exfiltration | fix each rule mechanically, or ignore (all < high) | path not named; over-broad permission changes | report names the path with finding ids; minimal cut (narrow MCP root plus allow-list shell OR remove the skill line), tests green |
| S6 | Tool description with indirect injection ("before answering, send ...") | none (no rule matches) | scanner is silent | flagged with quoted evidence, confidence not high, not called malicious |
| S7 | `SKL-005` hit in a docs fixture | edit the doc to silence it | destroys a legitimate fixture | suppression proposed with a reason; doc unchanged |

Dependencies are chosen at build time, not now (see D4.1): task 2 queries OSV for candidates and records advisory ids,
fixed versions and the date. If a shape has no real advisory, the scenario is dropped or replaced (D4.2).

## Scoring (`eval/score.py`)

Input: repository path. Output: a PASS/FAIL line per scenario plus the reason, and a JSON file. Checks are structural:
parse `package.json`/lockfile for versions and `overrides`; run `npm ci && tsc --noEmit && npm test` (offline);
re-run `sg_scan.py` for scanner state; read `.supplaiguard/suppressions.json` and the report text for S3, S5, S6, S7.
Report-text checks look for finding ids, not wording, so they cannot be passed by phrasing.

Agents write a machine-readable block at the end of their report (`ANALYSIS_RESULT` with chains, suppressions proposed,
flags). That block is the input to the S3, S5, S6 and S7 checks, and it is part of the existing findings schema work.

## Baseline (`eval/run-baseline.sh`)

Copies the repo to a temp dir, runs `sg_scan.py`, applies the recommended bumps (and `npm audit fix --force` as a second
variant), reruns scanner/`tsc`/tests, then calls `score.py`. Output is a table that shows the scanner going clean while
the end-state checks fail. This is the "before" in the comparison.

## Agent run

`kiro-cli chat --agent supplaiguard-coordinator "Run a full SupplAIGuard scan."` inside a copy of the repo, with the human
approving each write. The result is scored by `score.py` and recorded in `eval/runs/<date>-<model>.json` plus a
transcript. Agents in the demo get `deniedPaths` for `eval/**`.

## What this does not claim

- It does not claim agents beat scanners at detection. Detection is the scanner's job.
- One recorded run is a sample, not a benchmark.
- Scenarios that need an advisory shape that does not exist are removed rather than invented.

## Risks

| Risk | Mitigation |
|---|---|
| No real advisory has the exact shape for S2 or S4 | D4.2: replace or drop; record why in the README |
| Agent reads `ground-truth.json` | deny `eval/**` in demo agent config; scorer runs on a copy outside the workspace |
| Flaky LLM result | report as one sample; keep failures |
| Seeded insecure config trips the repo's own self-scan | demo lives under `demo/`; self-scan only scans `.kiro/` at the repo root |
