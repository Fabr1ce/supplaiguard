# Requirements: Reasoning Demo ("seance-gateway")

## Problem

The current demos (`vulnerable-ai-app`, `haunted-storyteller`, `crypt-keeper-mcp`) are solved by the deterministic
scanner alone: it matches `lodash@4.17.4` to an advisory and recommends a version. A reviewer cannot tell what the
agents add. We need a demo repository where the **correct outcome requires reasoning** that `sg_scan.py`, `npm audit`
and Dependabot cannot do, and where that claim is **measured**, not asserted.

## Glossary

- **Scanner-only baseline**: `sg_scan.py` findings plus the mechanical fix its report suggests (bump to the recommended
  version, or `npm audit fix --force`). No reasoning.
- **Agent run**: `supplaiguard-coordinator` on the same repository, with human approvals given as in a normal run.
- **Ground truth**: `demo/seance-gateway/eval/ground-truth.json`, written before any agent run, listing for each
  scenario the correct verdict and the end-state checks.

## Requirements

### D1. A realistic, runnable repository

**User story:** As a judge, I want a repository that looks like a real AI application, so that the fixes matter.

1. THE repository `demo/seance-gateway/` SHALL be a TypeScript (Node 22+) AI-agent gateway with: an HTTP API, an MCP
   server exposing tools, an agent definition under `.kiro/agents/`, a skill under `.kiro/skills/`, and a workspace
   `.kiro/settings/mcp.json`.
2. THE repository SHALL have a test suite (`npm test`) that passes on the unmodified code and exercises every code path
   the scenarios touch, so that a bad fix is detectable by failing tests, not by opinion.
3. THE repository SHALL build and its tests SHALL run offline after `npm ci`.

### D2. Scenarios that need reasoning

Each scenario SHALL have an id, a ground-truth verdict, and an end-state check. The set SHALL cover:

1. **S1 Breaking major upgrade.** A direct dependency has an advisory whose only fix is in a new major version with an
   API change used in at least three call sites. The mechanical bump SHALL make `npm test` or `tsc` fail. The correct
   outcome is: bump plus the code migration, tests green, scanner clean.
2. **S2 Transitive vulnerability with no direct fix.** The vulnerable package is transitive and its direct parent has no
   release that updates it. The correct outcome is an `overrides` entry (or equivalent) that keeps tests green, with the
   reason stated. A bump of the direct parent SHALL NOT be accepted as correct.
3. **S3 Reachability.** One dependency has several advisories that affect different functions. Some are reachable from
   user-controlled input in our code and some are never imported. The correct outcome is a per-advisory reachability
   statement with file evidence, and a fix that still clears every advisory. A suppression is proposed (never applied
   automatically) only for an advisory that cannot be fixed.
4. **S4 Constraint keeps the vulnerable copy alive.** Bumping a direct dependency clears the top-level finding, but a
   second package still pulls the old vulnerable copy. The correct outcome is a compatible set of versions (here, also
   bumping that second package) after reading its constraints, leaving no vulnerable copy in the lockfile, or an
   explicit high-impact proposal if no compatible set exists. A bump that only moves the top-level copy is not accepted.
5. **S5 Attack path across silos.** Four findings that are each medium or low alone (a dependency advisory in the MCP
   server's parser, an MCP filesystem root wider than needed, an agent with shell and no command allow-list, and a skill
   that tells the agent to read `.env` and include it in output) form one path to secret exfiltration. The correct
   outcome is a report that names the path and chains the findings, and the fix that cuts the path with the least
   permission change (not "fix all four equally").
6. **S6 Intent the rules cannot see.** An MCP tool description contains an indirect prompt-injection instruction that no
   `SKL-*` pattern matches. The correct outcome is that the agent flags it as suspicious with the quoted text as
   evidence and low-to-medium confidence, and does not call it malicious without evidence (security policy).
7. **S7 False positive.** A security-awareness document quotes "ignore previous instructions" as a test fixture, which
   triggers `SKL-005`. The correct outcome is a proposed suppression with a reason, not a "fix" that edits the document.

### D3. Measured comparison

1. THE repository SHALL include `eval/run-baseline.sh`, which applies the scanner-only baseline to a clean copy of the
   repository and records, per scenario: scanner findings cleared (yes/no), `npm test` and `tsc` result, and whether
   the end-state check passed.
2. THE repository SHALL include `eval/score.py`, which reads a repository state and `ground-truth.json` and prints a
   per-scenario PASS/FAIL table. It SHALL be deterministic and SHALL NOT call an LLM.
3. THE baseline SHALL fail S1, S2, S4, S5 and S7 on the end-state checks, and SHALL show that "scanner clean" is not the
   same as "correct" (for example S1 turns the scanner clean while tests fail). This SHALL be an automated test.
4. THE ground truth SHALL be committed before the first agent run and the agents SHALL NOT be given read access to
   `eval/` (denied in the demo's agent configuration and noted in the README).
5. THE README SHALL report the agent run's actual score table from a recorded run, including scenarios it failed. It
   SHALL NOT claim a result that was not produced by a recorded run.

### D4. Fidelity to the security policy

1. Every dependency version used SHALL be verified against OSV.dev when the repository is built; the advisory ids and
   fixed versions SHALL be recorded in `eval/ground-truth.json` with the date checked. Versions SHALL NOT be assumed.
2. A scenario SHALL be dropped or replaced, not faked, if no real advisory with the required shape exists.
3. The agent run SHALL follow the existing policy: every write asks the human, high-impact changes need explicit
   approval, fixes land on a `supplaiguard/fix-<scan_id>` branch, nothing merges, and a finding is `resolved` only
   after the Verification agent's re-check. The demo SHALL NOT weaken any agent permission.
4. The seeded insecure configs (S5, S6) SHALL contain only fake secrets that are obviously fake, and SHALL point at no
   real host.

### D5. Reproducibility and honesty

1. THE demo SHALL document how to reset to the unfixed state (`git checkout` of a tagged commit or `eval/reset.sh`).
2. LLM runs are not deterministic. THE README SHALL say so, and SHALL present the recorded run as one sample, with the
   model name and date.
3. A scenario the agent gets wrong SHALL be kept and reported. The goal is an honest picture of what the agents add.
